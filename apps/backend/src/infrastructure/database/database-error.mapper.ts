import { HttpException, Injectable } from '@nestjs/common';
import {
  extractErrorCode,
  isNodeConnectionError,
} from './database-error.util';
import {
  CheckConstraintViolationError,
  DatabaseConnectionError,
  DatabaseError,
  DeadlockError,
  ExclusionConstraintViolationError,
  ForeignKeyViolationError,
  NotNullViolationError,
  SerializationFailureError,
  StatementTimeoutError,
  UniqueConstraintViolationError,
  UnknownDatabaseError,
} from './database.errors';

/** PostgreSQL SQLSTATE codes this mapper recognizes explicitly. */
const SqlState = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  QUERY_CANCELED: '57014',
} as const;

/** SQLSTATE class 08 covers connection exceptions. */
const CONNECTION_SQLSTATE_CLASS = '08';

/**
 * Translates raw driver/Node errors into stable, safe application exceptions.
 *
 * Errors that are already application-level (our {@link DatabaseError} or any
 * {@link HttpException}, e.g. a domain error thrown inside a transaction) are
 * passed through unchanged so callers preserve their original meaning.
 */
@Injectable()
export class DatabaseErrorMapper {
  toApplicationError(error: unknown): unknown {
    if (error instanceof DatabaseError || error instanceof HttpException) {
      return error;
    }

    const code = extractErrorCode(error);

    switch (code) {
      case SqlState.UNIQUE_VIOLATION:
        return new UniqueConstraintViolationError(error);
      case SqlState.FOREIGN_KEY_VIOLATION:
        return new ForeignKeyViolationError(error);
      case SqlState.NOT_NULL_VIOLATION:
        return new NotNullViolationError(error);
      case SqlState.CHECK_VIOLATION:
        return new CheckConstraintViolationError(error);
      case SqlState.EXCLUSION_VIOLATION:
        return new ExclusionConstraintViolationError(error);
      case SqlState.SERIALIZATION_FAILURE:
        return new SerializationFailureError(error);
      case SqlState.DEADLOCK_DETECTED:
        return new DeadlockError(error);
      case SqlState.QUERY_CANCELED:
        return new StatementTimeoutError(error);
      default:
        break;
    }

    if (code?.startsWith(CONNECTION_SQLSTATE_CLASS) || isNodeConnectionError(error)) {
      return new DatabaseConnectionError(error);
    }

    return new UnknownDatabaseError(error);
  }
}
