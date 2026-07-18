import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

/**
 * Internal, sanitized authorization-failure reasons — for server-side logs and
 * diagnostics only. Never returned to clients (a denial always renders as a
 * generic `FORBIDDEN`).
 */
export enum AuthorizationDenialReason {
  PermissionDenied = 'permission_denied',
  ContextUnresolved = 'membership_context_unresolved',
}

/**
 * Base class for authorization failures. Extends {@link HttpException} so the
 * global exception filter renders it into the standard error envelope with a
 * stable public {@link ErrorCode}. The internal `reason` is never serialized.
 */
export abstract class AuthorizationError extends HttpException {
  protected constructor(
    status: HttpStatus,
    publicCode: ErrorCode,
    message: string,
    public readonly reason: string,
  ) {
    super({ code: publicCode, message }, status);
  }
}

/**
 * The caller is authenticated but not permitted to perform the action (403).
 * The response is intentionally generic; the specific missing permissions live
 * only in the internal `reason` so the API is not a permission-enumeration
 * oracle.
 */
export class ForbiddenError extends AuthorizationError {
  constructor(reason: string = AuthorizationDenialReason.PermissionDenied) {
    super(
      HttpStatus.FORBIDDEN,
      ErrorCode.FORBIDDEN,
      'You do not have permission to perform this action.',
      reason,
    );
  }
}

/**
 * Thrown when the authorization-context decorator is used on a route where the
 * guard did not attach a context (a route-wiring mistake — the route must
 * declare a permission requirement). Internal error, not a client failure.
 */
export class AuthorizationContextMissingError extends Error {
  constructor() {
    super(
      'No authorization context is attached to the request. Ensure the route ' +
        'declares @RequirePermissions and is protected by the authorization guard.',
    );
    this.name = 'AuthorizationContextMissingError';
  }
}
