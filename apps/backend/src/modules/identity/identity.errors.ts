import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

/**
 * The authenticated caller has no backend profile row. Surfaced only on
 * self-service profile endpoints (`/profiles/me`), where revealing that the
 * caller's own profile is absent is safe and actionable. Authorization paths
 * never raise this — they fail closed to a generic `403` instead.
 */
export class ProfileNotFoundError extends HttpException {
  constructor() {
    super(
      {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'No profile exists for the authenticated user.',
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * A membership addressed by id does not exist within the requested company.
 * Scoped-to-not-found by design: it never distinguishes "belongs to another
 * company" from "does not exist", so it is not a cross-tenant existence oracle.
 */
export class MembershipNotFoundError extends HttpException {
  constructor() {
    super(
      {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'The requested membership was not found.',
      },
      HttpStatus.NOT_FOUND,
    );
  }
}
