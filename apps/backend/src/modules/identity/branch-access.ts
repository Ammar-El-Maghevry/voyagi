import type { Membership } from './identity.types';
import { MembershipRole } from './membership-role';

/**
 * Resolved branch access for a caller within one company. Mirrors the database
 * `private.has_branch_access()` helper (migration `012_rls.sql`):
 *
 * - `company-wide` — a manager (or super admin) reaches every branch;
 * - `restricted` — an employee/agent reaches only the specific branches their
 *   active memberships are scoped to;
 * - `none` — the caller has no branch-level access in the company.
 */
export type BranchAccess =
  | { readonly kind: 'company-wide' }
  | { readonly kind: 'restricted'; readonly branchIds: readonly string[] }
  | { readonly kind: 'none' };

const COMPANY_WIDE_ROLES: readonly MembershipRole[] = [
  MembershipRole.SuperAdmin,
  MembershipRole.CompanyManager,
];

const BRANCH_SCOPED_ROLES: readonly MembershipRole[] = [
  MembershipRole.BranchEmployee,
  MembershipRole.Agent,
];

/**
 * Resolve branch access from a caller's active memberships in a single company.
 *
 * A single company-wide membership grants access to all branches. Otherwise,
 * access is the union of the branches that branch-scoped memberships name
 * (memberships without a branch grant no branch access, exactly as the RLS
 * helper requires `membership.branch_id = target_branch_id`).
 */
export function resolveBranchAccess(
  memberships: readonly Membership[],
): BranchAccess {
  if (memberships.some((m) => COMPANY_WIDE_ROLES.includes(m.role))) {
    return { kind: 'company-wide' };
  }

  const branchIds = new Set<string>();
  for (const membership of memberships) {
    if (
      BRANCH_SCOPED_ROLES.includes(membership.role) &&
      membership.branchId !== undefined
    ) {
      branchIds.add(membership.branchId);
    }
  }

  if (branchIds.size === 0) {
    return { kind: 'none' };
  }
  return { kind: 'restricted', branchIds: [...branchIds] };
}
