/**
 * Authorization slice of the request context.
 *
 * Built by trusted backend code (the authorization guard, via a resolver) from
 * the verified {@link AuthenticatedPrincipal} plus the caller's active company
 * membership. It carries only what authorization decisions and downstream
 * controllers need; it is never populated from client-supplied identity data.
 *
 * `permissions` are resolved server-side (from the database, in a later phase)
 * — the backend must not trust permissions or roles carried in a token.
 */
export interface AuthorizationContext {
  /** Verified auth user id (the token subject). */
  readonly userId: string;
  /** Resolved profile id for the user, when a profile has been resolved. */
  readonly profileId?: string;
  /** Active company (tenant) id, when the request is company-scoped. */
  readonly companyId?: string;
  /** Active membership id linking the user to the company. */
  readonly membershipId?: string;
  /** Company role name backing the granted permission set, when applicable. */
  readonly role?: string;
  /** Effective permissions granted to the caller in this context. */
  readonly permissions: readonly string[];
}
