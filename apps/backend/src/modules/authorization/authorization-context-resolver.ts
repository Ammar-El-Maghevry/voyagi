import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import type { AuthorizationContext } from './authorization-context';

/**
 * Input for resolving an {@link AuthorizationContext}. Assembled by the
 * authorization guard from trusted request state only.
 */
export interface AuthorizationResolutionRequest {
  /** The verified principal attached by the authentication guard. */
  readonly principal: AuthenticatedPrincipal;
  /**
   * The target company (tenant) id extracted from the request, when present.
   * Untrusted as an identity claim: the resolver must verify that the principal
   * has an active membership in this company before granting any permission.
   */
  readonly companyId?: string;
  /** Correlation id, for resolver-side logging. */
  readonly requestId: string;
}

/**
 * Port that resolves the authenticated caller's authorization context —
 * profile, active membership, role and effective permissions — from the system
 * of record.
 *
 * This is a contract only. The implementation (which reads `profiles` and
 * `company_memberships`) is provided by the identity/tenant phase and bound to
 * {@link AUTHORIZATION_CONTEXT_RESOLVER}. Returning `null` means no active,
 * authorized context could be established for the request (e.g. no active
 * membership in the target company) and the guard denies access.
 */
export interface AuthorizationContextResolver {
  resolve(
    request: AuthorizationResolutionRequest,
  ): Promise<AuthorizationContext | null>;
}

/** DI token an identity/tenant module binds to an {@link AuthorizationContextResolver}. */
export const AUTHORIZATION_CONTEXT_RESOLVER = Symbol(
  'AUTHORIZATION_CONTEXT_RESOLVER',
);
