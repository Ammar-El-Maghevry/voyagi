import type { AuthorizationContext } from '../authorization-context';

/**
 * Outcome of evaluating a single {@link AuthorizationPolicy}. A denial carries a
 * short, internal machine-readable reason for server-side logging only — it is
 * never returned to clients.
 */
export type PolicyResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/** A granted result. */
export const allow = (): PolicyResult => ({ allowed: true });

/** A denied result with an internal reason. */
export const deny = (reason: string): PolicyResult => ({
  allowed: false,
  reason,
});

/**
 * A single, composable authorization rule evaluated against a resolved
 * {@link AuthorizationContext}.
 *
 * Policies are pure and infrastructure-level: they decide access from the
 * context alone and must not perform I/O. Business-specific policies are added
 * by their owning modules in later phases; this phase ships only the permission
 * policy.
 */
export interface AuthorizationPolicy {
  /** Stable identifier used in denial diagnostics. */
  readonly name: string;
  evaluate(context: AuthorizationContext): PolicyResult;
}
