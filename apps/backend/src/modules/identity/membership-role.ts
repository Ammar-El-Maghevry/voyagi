/**
 * Application-side mirror of the database `public.user_role_enum` (defined in
 * migration `002_enums.sql`). These are the only role values the identity
 * domain trusts; a value read from the database that is not one of these is
 * treated as unknown and safely ignored (fail closed), never granted.
 *
 * The database column is the source of truth for a member's role — roles are
 * never read from token metadata.
 */
export enum MembershipRole {
  SuperAdmin = 'SUPER_ADMIN',
  CompanyManager = 'COMPANY_MANAGER',
  BranchEmployee = 'BRANCH_EMPLOYEE',
  Agent = 'AGENT',
  Passenger = 'PASSENGER',
}

/** Every known membership role. */
export const ALL_MEMBERSHIP_ROLES: readonly MembershipRole[] = Object.freeze(
  Object.values(MembershipRole),
);

/** Type guard: is `value` a known {@link MembershipRole}. */
export function isMembershipRole(value: string): value is MembershipRole {
  return (ALL_MEMBERSHIP_ROLES as readonly string[]).includes(value);
}

/**
 * Map a raw database role string to a {@link MembershipRole}, or `null` if it is
 * not a value this application version recognizes. Callers must handle `null`
 * by excluding the role (never by granting a default).
 */
export function parseMembershipRole(value: string): MembershipRole | null {
  return isMembershipRole(value) ? value : null;
}
