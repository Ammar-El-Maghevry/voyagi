import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

/**
 * A bus addressed by id is not present in the requested company. Scoped-to-not-
 * found by design: it never distinguishes "belongs to another company" or
 * "soft-deleted" from "does not exist", so it is not a cross-tenant existence
 * oracle.
 */
export class BusNotFoundError extends HttpException {
  constructor() {
    super(
      {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'The requested bus was not found.',
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * An activation transition was requested that does not apply — activating an
 * already-active bus, or deactivating an already-inactive one.
 */
export class BusStateConflictError extends HttpException {
  constructor(target: boolean) {
    super(
      {
        code: ErrorCode.CONFLICT,
        message: `The bus is already ${target ? 'active' : 'inactive'}.`,
      },
      HttpStatus.CONFLICT,
    );
  }
}
