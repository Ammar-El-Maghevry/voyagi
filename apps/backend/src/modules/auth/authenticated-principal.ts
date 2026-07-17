import type { JWTPayload } from 'jose';
import { AuthErrorReason, InvalidTokenError } from './auth.errors';

/**
 * Narrow, immutable identity of a verified caller.
 *
 * Contains only stable identity claims from a verified token. It deliberately
 * does NOT include `app_metadata`/`user_metadata`, company membership, or
 * permissions — those are authorization concerns resolved in a later phase.
 */
export interface AuthenticatedPrincipal {
  /** Verified subject (`sub`) — the Supabase auth user id. */
  readonly userId: string;
  /** Email claim, when present. */
  readonly email?: string;
  /**
   * The token's `role` claim (e.g. `authenticated`). This identifies the token
   * type/Postgres role; it is NOT an application authorization role.
   */
  readonly role?: string;
  /** Session id (`session_id`), when present. */
  readonly sessionId?: string;
  /** Issued-at (`iat`) epoch seconds, when present. */
  readonly issuedAt?: number;
  /** Expiry (`exp`) epoch seconds, when present. */
  readonly expiresAt?: number;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Map verified JWT claims to an {@link AuthenticatedPrincipal}. Only whitelisted
 * claims are copied; the raw payload is never exposed.
 *
 * @throws {InvalidTokenError} when the subject claim is missing.
 */
export function mapClaimsToPrincipal(
  payload: JWTPayload,
): AuthenticatedPrincipal {
  const userId = optionalString(payload.sub);
  if (userId === undefined) {
    throw new InvalidTokenError(AuthErrorReason.SubjectMissing);
  }

  return Object.freeze({
    userId,
    email: optionalString(payload.email),
    role: optionalString(payload.role),
    sessionId: optionalString(payload.session_id),
    issuedAt: optionalNumber(payload.iat),
    expiresAt: optionalNumber(payload.exp),
  });
}
