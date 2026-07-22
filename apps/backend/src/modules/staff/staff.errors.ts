import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

/**
 * A staff member addressed by id is not present in the requested company.
 * Scoped-to-not-found by design: it never distinguishes "belongs to another
 * company" or "soft-deleted" from "does not exist", so it is not a cross-tenant
 * existence oracle.
 */
export class StaffMemberNotFoundError extends HttpException {
  constructor() {
    super(
      {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'The requested staff member was not found.',
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * An activation transition was requested that does not apply — activating an
 * already-active staff member, or deactivating an already-inactive one.
 */
export class StaffMemberStateConflictError extends HttpException {
  constructor(target: boolean) {
    super(
      {
        code: ErrorCode.CONFLICT,
        message: `The staff member is already ${target ? 'active' : 'inactive'}.`,
      },
      HttpStatus.CONFLICT,
    );
  }
}
