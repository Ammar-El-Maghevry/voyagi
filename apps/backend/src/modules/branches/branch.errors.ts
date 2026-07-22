import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

/**
 * A branch addressed by id is not present in the requested company, or the
 * caller has no branch access to it. Scoped-to-not-found by design: it never
 * distinguishes "belongs to another company", "soft-deleted", and "not visible
 * to you", so it is not a cross-tenant or cross-branch existence oracle.
 */
export class BranchNotFoundError extends HttpException {
  constructor() {
    super(
      {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'The requested branch was not found.',
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * An activation transition was requested that does not apply — activating an
 * already-active branch, or deactivating an already-inactive one. Returned as a
 * conflict; the message never reveals internal state beyond the requested action.
 */
export class BranchStateConflictError extends HttpException {
  constructor(target: boolean) {
    super(
      {
        code: ErrorCode.CONFLICT,
        message: `The branch is already ${target ? 'active' : 'inactive'}.`,
      },
      HttpStatus.CONFLICT,
    );
  }
}
