import { ALL_PERMISSIONS, type Permission } from '../authorization/permission.enum';
import { type BranchAccess, resolveBranchAccess } from './branch-access';
import type { Membership } from './identity.types';
import { permissionsForRoles } from './role-permissions';

/**
 * A single membership's entitlement: the permissions its role grants, kept
 * **coupled** to the branch scope of that *same* membership.
 *
 * This coupling is the whole point. A caller's overall permissions and overall
 * branch access are each a union across memberships, and intersecting those two
 * independent unions would form a **cross-product** — e.g. an AGENT scoped to
 * Branch A (granting `bookings.create`) plus a BRANCH_EMPLOYEE scoped to Branch
 * B (granting no create) would wrongly appear to allow `bookings.create` in
 * Branch B. Evaluating a permission and a branch against the same
 * {@link Entitlement} makes that impossible by construction: a permission is
 * only ever admitted in a branch the membership that granted it actually
 * reaches.
 */
export interface Entitlement {
  readonly membership: Membership;
  /** Permissions granted by this membership's role alone. */
  readonly permissions: readonly Permission[];
  /** Branch scope of this membership alone (never the union across memberships). */
  readonly branchAccess: BranchAccess;
}

/**
 * Resolve one {@link Entitlement} per active membership, each carrying its own
 * role permissions and its own (single-membership) branch scope. The caller
 * passes the memberships already filtered to a single company; inactive
 * memberships must be excluded upstream so they contribute nothing here.
 */
export function resolveEntitlements(
  memberships: readonly Membership[],
): Entitlement[] {
  return memberships.map((membership) => ({
    membership,
    permissions: permissionsForRoles([membership.role]),
    // The scope of THIS membership alone — resolved from a one-element list so a
    // manager membership is company-wide and a branch-scoped one is limited to
    // its own branch; never the union across the caller's other memberships.
    branchAccess: resolveBranchAccess([membership]),
  }));
}

/** Whether a single membership's branch scope reaches `branchId`. */
function scopeReachesBranch(scope: BranchAccess, branchId: string): boolean {
  switch (scope.kind) {
    case 'company-wide':
      return true;
    case 'restricted':
      return scope.branchIds.includes(branchId);
    case 'none':
      return false;
  }
}

/**
 * The permissions the caller may exercise **in a specific branch**: the union of
 * permissions from the memberships whose *own* scope reaches that branch. A
 * permission and the branch are always weighed against the same membership, so
 * no independent union can leak a branch-scoped permission into a branch that
 * never granted it. Order follows the {@link Permission} catalog for
 * determinism; an empty result means the caller holds nothing in that branch
 * (fail closed).
 */
export function effectivePermissionsForBranch(
  entitlements: readonly Entitlement[],
  branchId: string,
): Permission[] {
  const granted = new Set<Permission>();
  for (const entitlement of entitlements) {
    if (scopeReachesBranch(entitlement.branchAccess, branchId)) {
      for (const permission of entitlement.permissions) {
        granted.add(permission);
      }
    }
  }
  return ALL_PERMISSIONS.filter((permission) => granted.has(permission));
}

/**
 * Whether `permission` may be exercised in `branchId` — true only when a
 * **single** membership grants both the permission and access to that branch.
 * This is the coupled check a branch-scoped authorization policy must use
 * instead of intersecting the flat permission and branch-access unions.
 */
export function canExercisePermissionInBranch(
  entitlements: readonly Entitlement[],
  permission: Permission,
  branchId: string,
): boolean {
  return entitlements.some(
    (entitlement) =>
      scopeReachesBranch(entitlement.branchAccess, branchId) &&
      entitlement.permissions.includes(permission),
  );
}
