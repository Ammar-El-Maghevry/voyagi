import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';
import {
  AuthorizationContextMissingError,
  AuthorizationDenialReason,
  ForbiddenError,
} from './authorization.errors';

describe('authorization errors', () => {
  it('ForbiddenError renders a generic 403 with a stable code and internal reason', () => {
    const error = new ForbiddenError('missing_permissions:bookings.cancel');

    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
    const body = error.getResponse() as { code: string; message: string };
    expect(body.code).toBe(ErrorCode.FORBIDDEN);
    // The public message must not leak which permission was missing.
    expect(body.message).not.toContain('bookings.cancel');
    // The internal reason is retained for logging, not serialization.
    expect(error.reason).toBe('missing_permissions:bookings.cancel');
    expect(JSON.stringify(body)).not.toContain('bookings.cancel');
  });

  it('ForbiddenError defaults to the permission-denied reason', () => {
    expect(new ForbiddenError().reason).toBe(
      AuthorizationDenialReason.PermissionDenied,
    );
  });

  it('AuthorizationContextMissingError is an internal error, not an HttpException', () => {
    const error = new AuthorizationContextMissingError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AuthorizationContextMissingError');
  });
});
