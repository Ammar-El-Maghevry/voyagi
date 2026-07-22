import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base class for translated database failures.
 *
 * Extends {@link HttpException} so the Phase 1 global exception filter renders
 * it into the standard error envelope with a stable, status-derived error code
 * and a safe client message. The original driver error is retained on `cause`
 * for server-side diagnostics only and is never serialized to clients (the
 * filter reads only the message from the HTTP response body).
 */
export abstract class DatabaseError extends HttpException {
  protected constructor(
    status: HttpStatus,
    message: string,
    /** Granular internal classification, for logs only. */
    public readonly dbErrorCode: string,
    /** Original driver/Node error, for diagnostics only. Never exposed. */
    public readonly driverError?: unknown,
  ) {
    super({ message }, status);
  }
}

/** Unique constraint violation (SQLSTATE 23505). */
export class UniqueConstraintViolationError extends DatabaseError {
  constructor(cause?: unknown) {
    super(
      HttpStatus.CONFLICT,
      'A record with the same unique value already exists.',
      'UNIQUE_VIOLATION',
      cause,
    );
  }
}

/** Foreign key violation (SQLSTATE 23503). */
export class ForeignKeyViolationError extends DatabaseError {
  constructor(cause?: unknown) {
    super(
      HttpStatus.CONFLICT,
      'A referenced record does not exist or is still in use.',
      'FOREIGN_KEY_VIOLATION',
      cause,
    );
  }
}

/**
 * Exclusion constraint violation (SQLSTATE 23P01) — a gist `EXCLUDE` overlap,
 * e.g. overlapping route price periods or overlapping bus trip windows. It is a
 * genuine conflict, so it maps to `409` like the other uniqueness/overlap errors.
 */
export class ExclusionConstraintViolationError extends DatabaseError {
  constructor(cause?: unknown) {
    super(
      HttpStatus.CONFLICT,
      'The requested change conflicts with an existing overlapping record.',
      'EXCLUSION_VIOLATION',
      cause,
    );
  }
}

/** Not-null violation (SQLSTATE 23502). */
export class NotNullViolationError extends DatabaseError {
  constructor(cause?: unknown) {
    super(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'A required value is missing.',
      'NOT_NULL_VIOLATION',
      cause,
    );
  }
}

/** Check constraint violation (SQLSTATE 23514). */
export class CheckConstraintViolationError extends DatabaseError {
  constructor(cause?: unknown) {
    super(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'A value violates a data constraint.',
      'CHECK_VIOLATION',
      cause,
    );
  }
}

/** Serialization failure (SQLSTATE 40001) — retryable. */
export class SerializationFailureError extends DatabaseError {
  constructor(cause?: unknown) {
    super(
      HttpStatus.CONFLICT,
      'The operation conflicted with a concurrent change. Please retry.',
      'SERIALIZATION_FAILURE',
      cause,
    );
  }
}

/** Deadlock detected (SQLSTATE 40P01) — retryable. */
export class DeadlockError extends DatabaseError {
  constructor(cause?: unknown) {
    super(
      HttpStatus.CONFLICT,
      'The operation conflicted with a concurrent change. Please retry.',
      'DEADLOCK_DETECTED',
      cause,
    );
  }
}

/** Statement timeout / query cancelled (SQLSTATE 57014). */
export class StatementTimeoutError extends DatabaseError {
  constructor(cause?: unknown) {
    super(
      HttpStatus.SERVICE_UNAVAILABLE,
      'The database operation timed out.',
      'STATEMENT_TIMEOUT',
      cause,
    );
  }
}

/** Connection failure (SQLSTATE class 08, or a Node socket error). */
export class DatabaseConnectionError extends DatabaseError {
  constructor(cause?: unknown) {
    super(
      HttpStatus.SERVICE_UNAVAILABLE,
      'The database is currently unavailable.',
      'CONNECTION_ERROR',
      cause,
    );
  }
}

/** Any database error not otherwise classified. */
export class UnknownDatabaseError extends DatabaseError {
  constructor(cause?: unknown) {
    super(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'An unexpected database error occurred.',
      'UNKNOWN',
      cause,
    );
  }
}
