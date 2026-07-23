import type { AuthenticatedPrincipal } from '../../../src/modules/auth/authenticated-principal';

/**
 * Typed JWT-principal fixture for security tests. Deterministic defaults with
 * typed overrides; carries no real personal information and no real secret. Use
 * {@link principalClaims} to build a Supabase-style claim set and
 * {@link authenticatedPrincipal} to build the verified principal the auth layer
 * produces.
 */
export interface PrincipalOverrides {
  userId?: string;
  email?: string;
  role?: string;
  appMetadataRole?: string;
  extraClaims?: Record<string, unknown>;
}

const DEFAULT_USER_ID = '96000000-0000-4000-8000-0000000000f1';

/** Build a Supabase-style JWT claim set for the given principal overrides. */
export function principalClaims(
  overrides: PrincipalOverrides = {},
): Record<string, unknown> {
  const appMetadata: Record<string, unknown> = {};
  if (overrides.appMetadataRole !== undefined) {
    appMetadata.role = overrides.appMetadataRole;
  }
  return {
    sub: overrides.userId ?? DEFAULT_USER_ID,
    email: overrides.email ?? 'fixture-user@voyagi.test',
    role: overrides.role ?? 'authenticated',
    app_metadata: appMetadata,
    ...overrides.extraClaims,
  };
}

/** Build the verified principal that the authentication layer resolves. */
export function authenticatedPrincipal(
  overrides: PrincipalOverrides = {},
): AuthenticatedPrincipal {
  return {
    userId: overrides.userId ?? DEFAULT_USER_ID,
    email: overrides.email ?? 'fixture-user@voyagi.test',
  } as AuthenticatedPrincipal;
}
