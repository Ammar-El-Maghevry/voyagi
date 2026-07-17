import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

/**
 * Internal, sanitized failure classification — for server-side logs and
 * diagnostics only. Never returned to clients.
 */
export enum AuthErrorReason {
  MissingCredentials = 'missing_credentials',
  MalformedHeader = 'malformed_authorization_header',
  Expired = 'token_expired',
  NotYetValid = 'token_not_yet_valid',
  SignatureInvalid = 'signature_invalid',
  IssuerMismatch = 'issuer_mismatch',
  AudienceMismatch = 'audience_mismatch',
  AlgorithmNotAllowed = 'algorithm_not_allowed',
  Malformed = 'token_malformed',
  SubjectMissing = 'subject_missing',
  ClaimInvalid = 'claim_invalid',
  JwksUnavailable = 'jwks_unavailable',
  Unknown = 'unknown',
}

/**
 * Base class for authentication failures. Extends {@link HttpException} so the
 * global exception filter renders it into the standard error envelope with the
 * stable public code. The internal `reason` is never serialized to clients.
 */
export abstract class AuthenticationError extends HttpException {
  protected constructor(
    status: HttpStatus,
    publicCode: string,
    message: string,
    public readonly reason: AuthErrorReason,
  ) {
    super({ code: publicCode, message }, status);
  }
}

/** No credentials were provided on a protected route. */
export class MissingCredentialsError extends AuthenticationError {
  constructor() {
    super(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.UNAUTHENTICATED,
      'Authentication credentials were not provided.',
      AuthErrorReason.MissingCredentials,
    );
  }
}

/** The Authorization header was present but malformed. */
export class MalformedAuthorizationHeaderError extends AuthenticationError {
  constructor() {
    super(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.UNAUTHENTICATED,
      'The Authorization header is malformed.',
      AuthErrorReason.MalformedHeader,
    );
  }
}

/** The token is well-formed and verified but has expired. */
export class TokenExpiredError extends AuthenticationError {
  constructor() {
    super(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.TOKEN_EXPIRED,
      'The access token has expired.',
      AuthErrorReason.Expired,
    );
  }
}

/** The token failed verification for any non-expiry reason. */
export class InvalidTokenError extends AuthenticationError {
  constructor(reason: AuthErrorReason) {
    super(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.TOKEN_INVALID,
      'The access token is invalid.',
      reason,
    );
  }
}

/**
 * The verification infrastructure (JWKS endpoint) is unavailable. Fails closed:
 * access is denied, surfaced as a dependency failure rather than an invalid
 * token (the client's credentials may be fine; the server cannot verify them).
 */
export class JwksUnavailableError extends AuthenticationError {
  constructor() {
    super(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.DEPENDENCY_FAILURE,
      'Unable to verify credentials at this time.',
      AuthErrorReason.JwksUnavailable,
    );
  }
}

/**
 * Thrown when the current-principal decorator is used on a route where no
 * verified principal exists (a route wiring mistake). This is an internal
 * error, not a client authentication failure.
 */
export class PrincipalUnavailableError extends Error {
  constructor() {
    super(
      'No authenticated principal is attached to the request. ' +
        'Ensure the route is protected by the authentication guard.',
    );
    this.name = 'PrincipalUnavailableError';
  }
}
