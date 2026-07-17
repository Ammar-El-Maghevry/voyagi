import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolConfig } from 'pg';
import type { DatabaseConfig, DatabaseSslMode } from '../../config';
import { extractErrorCode } from './database-error.util';

/**
 * Translate an `sslmode` value into a `pg` SSL option.
 *
 * `require`/`no-verify` encrypt the connection without CA verification;
 * `verify-ca`/`verify-full` require a valid certificate chain (provide the CA
 * via the deployment environment). Verification is only relaxed for modes that
 * explicitly request it — it is never silently disabled for a verifying mode.
 */
function resolveSsl(mode: DatabaseSslMode): false | { rejectUnauthorized: boolean } {
  switch (mode) {
    case 'disable':
      return false;
    case 'require':
    case 'no-verify':
      return { rejectUnauthorized: false };
    case 'verify-ca':
    case 'verify-full':
      return { rejectUnauthorized: true };
    default:
      return false;
  }
}

/**
 * Create the shared PostgreSQL connection pool from typed configuration.
 *
 * Fails fast when the connection string is missing (mandatory in production).
 * The pool is lazy: it does not open a connection until the first query, so the
 * application boots even when the database is temporarily unreachable. Pool
 * errors are handled so a dropped idle connection never crashes the process,
 * and the connection string is never logged.
 */
export function createDatabasePool(config: ConfigService): Pool {
  const db = config.getOrThrow<DatabaseConfig>('database');
  const logger = new Logger('DatabasePool');

  if (!db.url) {
    throw new Error(
      'DATABASE_URL is required but was not provided. It must be set explicitly in production.',
    );
  }

  const poolConfig: PoolConfig = {
    connectionString: db.url,
    application_name: db.applicationName,
    min: db.poolMin,
    max: db.poolMax,
    connectionTimeoutMillis: db.connectionTimeoutMs,
    idleTimeoutMillis: db.idleTimeoutMs,
    statement_timeout: db.statementTimeoutMs,
    ssl: resolveSsl(db.sslMode),
    // Keep the pool alive even when idle so shutdown is the only thing that
    // ends it.
    allowExitOnIdle: false,
  };

  const pool = new Pool(poolConfig);

  // An idle client can error out (e.g. the server drops the connection).
  // Handle it so it never becomes an unhandled exception. Log only a
  // sanitized code, never the connection string or full error.
  pool.on('error', (error) => {
    logger.error(
      { event: 'idle_client_error', code: extractErrorCode(error) ?? 'UNKNOWN' },
      'Idle database client error',
    );
  });

  // Connection lifecycle events, logged safely (no connection string / secrets).
  pool.on('connect', () => logger.debug({ event: 'client_connected' }));
  pool.on('remove', () => logger.debug({ event: 'client_removed' }));

  return pool;
}
