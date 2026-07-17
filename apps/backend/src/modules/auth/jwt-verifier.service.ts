import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify } from 'jose';
import type { AuthConfig } from '../../config';
import {
  AuthenticationError,
  AuthErrorReason,
  InvalidTokenError,
  JwksUnavailableError,
  TokenExpiredError,
} from './auth.errors';
import {
  mapClaimsToPrincipal,
  type AuthenticatedPrincipal,
} from './authenticated-principal';
import {
  AUTH_KEY_RESOLVER,
  type AuthKeyResolver,
} from './jwks-key-resolver.provider';

/** Node socket error codes indicating the JWKS endpoint is unreachable. */
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Verifies Supabase-issued access tokens.
 *
 * Verification is asymmetric (JWKS): `jose` checks the signature, algorithm
 * allow-list, issuer, audience, expiry and not-before. Verifier errors are
 * translated into stable, safe authentication errors and never surfaced raw.
 */
@Injectable()
export class JwtVerifierService {
  constructor(
    @Inject(AUTH_KEY_RESOLVER) private readonly keyResolver: AuthKeyResolver,
    private readonly config: ConfigService,
  ) {}

  /**
   * Verify a token and return the authenticated principal.
   * @throws {AuthenticationError} on any verification failure (fails closed).
   */
  async verify(token: string): Promise<AuthenticatedPrincipal> {
    const auth = this.config.getOrThrow<AuthConfig>('auth');

    try {
      const { payload } = await jwtVerify(token, this.keyResolver, {
        issuer: auth.issuer,
        audience: auth.audience,
        algorithms: auth.algorithms,
        clockTolerance: auth.clockToleranceSeconds,
      });
      return mapClaimsToPrincipal(payload);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        // Already classified (e.g. missing subject from the mapper). Note that
        // jose claim errors also carry a `reason`, so an `instanceof` check is
        // required here rather than duck typing.
        throw error;
      }
      throw this.mapVerificationError(error);
    }
  }

  private mapVerificationError(error: unknown): AuthenticationError {
    if (this.isJwksInfrastructureError(error)) {
      return new JwksUnavailableError();
    }

    switch (errorCode(error)) {
      case 'ERR_JWT_EXPIRED':
        return new TokenExpiredError();
      case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
        return new InvalidTokenError(this.claimReason(error));
      case 'ERR_JOSE_ALG_NOT_ALLOWED':
        return new InvalidTokenError(AuthErrorReason.AlgorithmNotAllowed);
      case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
      case 'ERR_JWKS_NO_MATCHING_KEY':
      case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
        return new InvalidTokenError(AuthErrorReason.SignatureInvalid);
      case 'ERR_JWS_INVALID':
      case 'ERR_JWT_INVALID':
      case 'ERR_JOSE_NOT_SUPPORTED':
        return new InvalidTokenError(AuthErrorReason.Malformed);
      default:
        return new InvalidTokenError(AuthErrorReason.Unknown);
    }
  }

  /** Map a claim-validation failure to a specific internal reason. */
  private claimReason(error: unknown): AuthErrorReason {
    const claim = (error as { claim?: unknown }).claim;
    switch (claim) {
      case 'iss':
        return AuthErrorReason.IssuerMismatch;
      case 'aud':
        return AuthErrorReason.AudienceMismatch;
      case 'nbf':
        return AuthErrorReason.NotYetValid;
      case 'sub':
        return AuthErrorReason.SubjectMissing;
      default:
        return AuthErrorReason.ClaimInvalid;
    }
  }

  /** Whether the failure is a JWKS fetch timeout / network unavailability. */
  private isJwksInfrastructureError(error: unknown): boolean {
    if (errorCode(error) === 'ERR_JWKS_TIMEOUT') {
      return true;
    }
    if (NETWORK_ERROR_CODES.has(errorCode(error) ?? '')) {
      return true;
    }
    const cause = (error as { cause?: unknown } | null)?.cause;
    if (cause && NETWORK_ERROR_CODES.has(errorCode(cause) ?? '')) {
      return true;
    }
    // A non-200 response from the JWKS endpoint (jose throws a generic JOSE
    // error): the endpoint is reachable but unhealthy, so we still fail closed
    // as "unavailable" rather than treating the caller's token as invalid.
    if (this.isJwksHttpError(error)) {
      return true;
    }
    // `fetch` connection failures surface as a TypeError ("fetch failed").
    return (
      error instanceof TypeError && /fetch/i.test((error as Error).message)
    );
  }

  /** Whether jose rejected the JWKS HTTP response as non-200. */
  private isJwksHttpError(error: unknown): boolean {
    const message = (error as { message?: unknown } | null)?.message;
    return (
      typeof message === 'string' && /JSON Web Key Set HTTP/i.test(message)
    );
  }
}
