/**
 * Public surface of the database infrastructure module.
 *
 * Later phases should import the database abstractions from here:
 *
 * ```ts
 * import { DatabaseService, TransactionManager } from '../../infrastructure/database';
 * ```
 */
export { DatabaseModule } from './database.module';
export { DatabaseService } from './database.service';
export {
  TransactionManager,
  Transaction,
  IsolationLevel,
  type TransactionOptions,
} from './transaction.manager';
export { DatabaseErrorMapper } from './database-error.mapper';
export { DATABASE_POOL } from './database.constants';
export { DatabaseReadinessIndicator } from './database-readiness.indicator';
export type {
  DatabaseExecutor,
  QueryMeta,
  PoolStats,
} from './database.types';
export {
  DatabaseError,
  UniqueConstraintViolationError,
  ForeignKeyViolationError,
  NotNullViolationError,
  CheckConstraintViolationError,
  SerializationFailureError,
  DeadlockError,
  StatementTimeoutError,
  DatabaseConnectionError,
  UnknownDatabaseError,
} from './database.errors';
