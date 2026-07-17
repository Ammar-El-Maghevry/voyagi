import { HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseErrorMapper } from './database-error.mapper';
import {
  CheckConstraintViolationError,
  DatabaseConnectionError,
  DeadlockError,
  ForeignKeyViolationError,
  NotNullViolationError,
  SerializationFailureError,
  StatementTimeoutError,
  UniqueConstraintViolationError,
  UnknownDatabaseError,
} from './database.errors';

/** Build a fake pg driver error carrying a SQLSTATE code. */
function pgError(code: string, message = 'db error'): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe('DatabaseErrorMapper', () => {
  const mapper = new DatabaseErrorMapper();

  it.each([
    ['23505', UniqueConstraintViolationError, HttpStatus.CONFLICT],
    ['23503', ForeignKeyViolationError, HttpStatus.CONFLICT],
    ['23502', NotNullViolationError, HttpStatus.UNPROCESSABLE_ENTITY],
    ['23514', CheckConstraintViolationError, HttpStatus.UNPROCESSABLE_ENTITY],
    ['40001', SerializationFailureError, HttpStatus.CONFLICT],
    ['40P01', DeadlockError, HttpStatus.CONFLICT],
    ['57014', StatementTimeoutError, HttpStatus.SERVICE_UNAVAILABLE],
    ['08006', DatabaseConnectionError, HttpStatus.SERVICE_UNAVAILABLE],
  ])('maps SQLSTATE %s to the expected typed error', (code, Type, status) => {
    const mapped = mapper.toApplicationError(pgError(code));
    expect(mapped).toBeInstanceOf(Type);
    expect((mapped as HttpException).getStatus()).toBe(status);
  });

  it('maps Node connection errors (ECONNREFUSED) to a connection error', () => {
    const mapped = mapper.toApplicationError(pgError('ECONNREFUSED'));
    expect(mapped).toBeInstanceOf(DatabaseConnectionError);
  });

  it('maps an unrecognized error to a sanitized unknown error (500)', () => {
    const mapped = mapper.toApplicationError(
      pgError('99999', 'table users column password leaked'),
    );
    expect(mapped).toBeInstanceOf(UnknownDatabaseError);
    expect((mapped as HttpException).getStatus()).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    // The client-facing message must not contain the raw internal detail.
    const body = (mapped as HttpException).getResponse();
    expect(JSON.stringify(body)).not.toContain('password leaked');
    expect(JSON.stringify(body)).not.toContain('99999');
  });

  it('retains the original driver error internally but never in the response body', () => {
    const original = pgError('23505', 'duplicate key value violates unique constraint');
    const mapped = mapper.toApplicationError(original) as UniqueConstraintViolationError;

    expect(mapped.driverError).toBe(original);
    expect(JSON.stringify(mapped.getResponse())).not.toContain(
      'violates unique constraint',
    );
  });

  it('passes through application errors (HttpException) unchanged', () => {
    const appError = new HttpException('domain rule violated', HttpStatus.CONFLICT);
    expect(mapper.toApplicationError(appError)).toBe(appError);
  });
});
