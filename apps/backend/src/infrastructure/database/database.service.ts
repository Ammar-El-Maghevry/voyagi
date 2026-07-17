import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { DatabaseConfig } from '../../config';
import { DATABASE_POOL } from './database.constants';
import { DatabaseErrorMapper } from './database-error.mapper';
import { extractErrorCode } from './database-error.util';
import type {
  DatabaseExecutor,
  PoolStats,
  QueryMeta,
} from './database.types';

/**
 * Pool-backed query executor and the primary database entry point for
 * repositories.
 *
 * Responsibilities:
 * - run parameterized queries against the pool;
 * - translate driver errors into stable application exceptions;
 * - emit sanitized, structured observability (never SQL parameters);
 * - report pool utilization;
 * - close the pool on graceful shutdown.
 *
 * For multi-statement atomic work, use {@link TransactionManager} instead.
 */
@Injectable()
export class DatabaseService implements DatabaseExecutor, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private closed = false;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly errorMapper: DatabaseErrorMapper,
    private readonly config: ConfigService,
  ) {}

  /**
   * Execute a parameterized query. Values must always be passed via `params`;
   * never interpolate user-controlled values into `text`.
   */
  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
    meta?: QueryMeta,
  ): Promise<QueryResult<R>> {
    const startedAt = Date.now();
    try {
      const result = await this.pool.query<R>(text, params as unknown[]);
      this.logCompletion(meta, startedAt, 'success', text, result.rowCount);
      return result;
    } catch (error) {
      this.logCompletion(meta, startedAt, 'failure', text, undefined, error);
      throw this.errorMapper.toApplicationError(error);
    }
  }

  /**
   * Borrow a pooled client for the duration of `work` and always release it.
   * Prefer {@link TransactionManager} for transactional work.
   */
  async withClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await work(client);
    } finally {
      client.release();
    }
  }

  /** Current pool utilization; safe to log. */
  getPoolStats(): PoolStats {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }

  /** Close the pool during application shutdown (idempotent). */
  async onApplicationShutdown(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.pool.end();
    this.logger.log('Database connection pool closed');
  }

  private logCompletion(
    meta: QueryMeta | undefined,
    startedAt: number,
    status: 'success' | 'failure',
    text: string,
    rowCount?: number | null,
    error?: unknown,
  ): void {
    const db = this.config.get<DatabaseConfig>('database');
    const durationMs = Date.now() - startedAt;
    const base = {
      operation: meta?.name,
      requestId: meta?.requestId,
      durationMs,
      status,
    };

    if (status === 'failure') {
      // Sanitized: SQLSTATE code only, never SQL text or parameters.
      this.logger.warn({ ...base, dbErrorCode: extractErrorCode(error) });
      return;
    }

    if (db?.logQueries) {
      // Developer opt-in: log the SQL text (never parameters).
      this.logger.debug({ ...base, rowCount, sql: text });
    } else if (db && durationMs >= db.slowQueryMs) {
      // Slow-query warning: metadata only, no SQL text or parameters.
      this.logger.warn({ ...base, rowCount, slow: true });
    }
  }
}
