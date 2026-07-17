import { registerAs } from '@nestjs/config';
import { parseBoolean, parseInteger } from './parse.util';

/**
 * Local Supabase Postgres URL used as a safe default outside production so the
 * app and tests work against the local stack without extra configuration.
 * Production must set `DATABASE_URL` explicitly (enforced in the pool factory).
 */
export const LOCAL_DATABASE_URL =
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Supported `sslmode` values, aligned with libpq semantics. */
export type DatabaseSslMode =
  | 'disable'
  | 'require'
  | 'no-verify'
  | 'verify-ca'
  | 'verify-full';

/**
 * Database configuration namespace.
 *
 * The connection string is never exposed outside this layer and must never be
 * logged. Numeric pool/timeout values have safe local defaults; production is
 * expected to set them explicitly via the deployment environment.
 */
export const databaseConfig = registerAs('database', () => {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    // In production the URL must be provided explicitly (validated at pool
    // creation). Outside production we fall back to the local Supabase stack.
    url: process.env.DATABASE_URL ?? (isProduction ? '' : LOCAL_DATABASE_URL),
    applicationName: process.env.DATABASE_APP_NAME ?? 'voyagi-api',
    poolMin: parseInteger(process.env.DATABASE_POOL_MIN, 0),
    poolMax: parseInteger(process.env.DATABASE_POOL_MAX, 10),
    connectionTimeoutMs: parseInteger(
      process.env.DATABASE_CONNECTION_TIMEOUT_MS,
      10_000,
    ),
    idleTimeoutMs: parseInteger(process.env.DATABASE_IDLE_TIMEOUT_MS, 30_000),
    statementTimeoutMs: parseInteger(
      process.env.DATABASE_STATEMENT_TIMEOUT_MS,
      30_000,
    ),
    sslMode: (process.env.DATABASE_SSL_MODE ??
      (isProduction ? 'require' : 'disable')) as DatabaseSslMode,
    // Bounded timeout for the readiness probe query.
    readinessTimeoutMs: parseInteger(
      process.env.DATABASE_READINESS_TIMEOUT_MS,
      2_000,
    ),
    // Development-only: log sanitized query metadata (never parameters).
    logQueries: parseBoolean(process.env.DATABASE_LOG_QUERIES, false),
    // Warn when a query exceeds this duration (metadata only, sanitized).
    slowQueryMs: parseInteger(process.env.DATABASE_SLOW_QUERY_MS, 500),
  };
});
