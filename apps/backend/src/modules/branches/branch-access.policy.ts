import { Permission } from '../authorization/permission.enum';
import {
  canExercisePermissionInBranch,
  type Entitlement,
} from '../identity/entitlements';

/**
 * The set of branches a caller may read, derived **only** from memberships whose
 * own entitlement grants `branches.read`, keeping the permission coupled to that
 * same membership's branch scope:
 *
 * - `all` — a company-wide member (manager/super-admin) reads every branch;
 * - `restricted` — the union of the branches that branch-scoped memberships
 *   granting `branches.read` reach;
 * - `none` — no membership grants a readable branch.
 */
export type BranchReadScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'restricted'; readonly branchIds: readonly string[] }
  | { readonly kind: 'none' };

/**
 * Resolve the caller's readable-branch scope from their per-membership
 * {@link Entitlement}s.
 *
 * Critically, this never intersects the flat permission union with the flat
 * branch-access union — that cross-product would let `branches.read` from one
 * membership pair with a branch reached only by a different membership. Instead
 * it considers each membership's `branches.read` grant against that same
 * membership's branch scope.
 */
export function readableBranchScope(
  entitlements: readonly Entitlement[],
): BranchReadScope {
  const readers = entitlements.filter((entitlement) =>
    entitlement.permissions.includes(Permission.BranchesRead),
  );

  // Any company-wide reader sees every branch — no need to enumerate ids.
  if (readers.some((entitlement) => entitlement.branchAccess.kind === 'company-wide')) {
    return { kind: 'all' };
  }

  const branchIds = new Set<string>();
  for (const entitlement of readers) {
    if (entitlement.branchAccess.kind === 'restricted') {
      for (const branchId of entitlement.branchAccess.branchIds) {
        branchIds.add(branchId);
      }
    }
  }
  return branchIds.size > 0
    ? { kind: 'restricted', branchIds: [...branchIds] }
    : { kind: 'none' };
}

/**
 * Whether the caller may read a specific branch: true only when a **single**
 * membership grants both `branches.read` and access to that branch. Delegates to
 * the Phase 5 coupled-entitlement check so the anti-cross-product guarantee is
 * shared, not re-derived.
 */
export function canReadBranch(
  entitlements: readonly Entitlement[],
  branchId: string,
): boolean {
  return canExercisePermissionInBranch(
    entitlements,
    Permission.BranchesRead,
    branchId,
  );
}
