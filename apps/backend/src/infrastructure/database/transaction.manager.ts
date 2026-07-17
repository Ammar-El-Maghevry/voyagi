import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DATABASE_POOL } from './database.constants';
import { DatabaseErrorMapper } from './database-error.mapper';
import { extractErrorCode } from './database-error.util';
import type { DatabaseExecutor, QueryMeta } from './database.types';

/** PostgreSQL transaction isolation levels. */
export enum IsolationLevel {
  ReadCommitted = 'READ COMMITTED',
  RepeatableRead = 'REPEATABLE READ',
  Serializable = 'SERIALIZABLE',
}

/** Options controlling a transaction's boundary. */
export interface TransactionOptions {
  isolationLevel?: IsolationLevel;
  readOnly?: boolean;
  /** Correlation id, propagated into transaction logs when available. */
  requestId?: string;
}

/**
 * A single-connection, in-transaction query executor handed to the callback of
 * {@link TransactionManager.run}. All queries run on the same client and share
 * the surrounding transaction.
 */
export class Transaction implements DatabaseExecutor {
  constructor(
    private readonly client: PoolClient,
    private readonly errorMapper: DatabaseErrorMapper,
  ) {}

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
    _meta?: QueryMeta,
  ): Promise<QueryResult<R>> {
    try {
      return await this.client.query<R>(text, params as unknown[]);
    } catch (error) {
      throw this.errorMapper.toApplicationError(error);
    }
  }
}

/**
 * Runs work inside a database transaction: `BEGIN`, then `COMMIT` on success or
 * `ROLLBACK` on any failure, always releasing the client.
 *
 * Nesting is not supported in Phase 2: each `run` acquires its own pooled
 * client and independent transaction. Do not call `run` inside another `run`
 * callback — pass the provided {@link Transaction} executor to collaborators
 * instead. Savepoint-based nesting can be added later if a use case requires
 * it.
 */
@Injectable()
export class TransactionManager {
  private readonly logger = new Logger(TransactionManager.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly errorMapper: DatabaseErrorMapper,
  ) {}

  async run<T>(
    work: (tx: Transaction) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    const client = await this.pool.connect();
    const tx = new Transaction(client, this.errorMapper);
    const startedAt = Date.now();

    try {
      await this.exec(client, this.buildBeginStatement(options));
      const result = await work(tx);
      await this.exec(client, 'COMMIT');
      this.logger.debug({
        event: 'transaction_committed',
        requestId: options.requestId,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      await this.safeRollback(client, options.requestId);
      this.logger.debug({
        event: 'transaction_rolled_back',
        requestId: options.requestId,
        durationMs: Date.now() - startedAt,
      });
      // Preserve the original error: driver errors raised via `tx.query` (and
      // the BEGIN/COMMIT statements below) are already translated, while
      // application/domain errors thrown by the callback are rethrown intact.
      throw error;
    } finally {
      client.release();
    }
  }

  /** Run an internal control statement, translating any driver error. */
  private async exec(client: PoolClient, sql: string): Promise<void> {
    try {
      await client.query(sql);
    } catch (error) {
      throw this.errorMapper.toApplicationError(error);
    }
  }

  /**
   * Build the `BEGIN` statement. The isolation level comes from a fixed enum
   * (never user input), so string composition here is injection-safe.
   */
  private buildBeginStatement(options: TransactionOptions): string {
    let statement = 'BEGIN';
    if (options.isolationLevel) {
      statement += ` ISOLATION LEVEL ${options.isolationLevel}`;
    }
    if (options.readOnly) {
      statement += ' READ ONLY';
    }
    return statement;
  }

  /**
   * Roll back without masking the primary failure. A rollback error is logged
   * (sanitized) but never thrown in place of the original error.
   */
  private async safeRollback(
    client: PoolClient,
    requestId?: string,
  ): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      this.logger.error({
        event: 'rollback_failed',
        requestId,
        dbErrorCode: extractErrorCode(rollbackError),
      });
    }
  }
}
