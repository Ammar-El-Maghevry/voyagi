import type { QueryResult, QueryResultRow } from 'pg';

/**
 * Optional, sanitized metadata attached to a query for observability.
 * Never include SQL text or parameter values here.
 */
export interface QueryMeta {
  /** Stable logical operation name, e.g. `bookings.insert`. */
  name?: string;
  /** Correlation id, propagated from the request context when available. */
  requestId?: string;
}

/**
 * Narrow, transaction-agnostic query surface.
 *
 * Both {@link DatabaseService} (pool-backed) and a transaction handle implement
 * this, so repositories in later phases can accept either an ambient executor
 * or an in-transaction executor without knowing the difference.
 */
export interface DatabaseExecutor {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
    meta?: QueryMeta,
  ): Promise<QueryResult<R>>;
}

/** Snapshot of pool utilization (safe to log; contains no secrets). */
export interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
}
