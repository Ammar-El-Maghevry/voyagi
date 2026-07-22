import { Permission } from '../authorization/permission.enum';
import {
  canExercisePermissionInBranch,
  effectivePermissionsForBranch,
  resolveEntitlements,
} from './entitlements';
import type { Membership } from './identity.types';
import { MembershipRole } from './membership-role';

const USER = '11111111-1111-1111-1111-111111111111';
const now = new Date('2026-01-01T00:00:00.000Z');
const BRANCH_A = 'branch-A';
const BRANCH_B = 'branch-B';

function membership(
  role: MembershipRole,
  overrides: Partial<Membership> = {},
): Membership {
  return {
    id: '1',
    userId: USER,
    companyId: '10',
    role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('entitlements — branch-coupled authority', () => {
  // Membership A: AGENT at Branch A → grants bookings.create (plus read set).
  // Membership B: BRANCH_EMPLOYEE at Branch B → read set only, no bookings.create.
  const agentA = membership(MembershipRole.Agent, { id: 'A', branchId: BRANCH_A });
  const employeeB = membership(MembershipRole.BranchEmployee, {
    id: 'B',
    branchId: BRANCH_B,
  });

  describe('resolveEntitlements couples each grant to its own branch scope', () => {
    it('scopes each membership independently, not to the caller-wide union', () => {
      const [entA, entB] = resolveEntitlements([agentA, employeeB]);

      expect(entA.permissions).toContain(Permission.BookingsCreate);
      expect(entA.branchAccess).toEqual({
        kind: 'restricted',
        branchIds: [BRANCH_A],
      });

      expect(entB.permissions).not.toContain(Permission.BookingsCreate);
      expect(entB.branchAccess).toEqual({
        kind: 'restricted',
        branchIds: [BRANCH_B],
      });
    });
  });

  describe('point 1 — a permission cannot leak into another membership’s branch', () => {
    const entitlements = resolveEntitlements([agentA, employeeB]);

    it('bookings.create is exercisable in Branch A (its granting membership)', () => {
      expect(
        canExercisePermissionInBranch(entitlements, Permission.BookingsCreate, BRANCH_A),
      ).toBe(true);
    });

    it('bookings.create is NOT exercisable in Branch B (no membership grants it there)', () => {
      expect(
        canExercisePermissionInBranch(entitlements, Permission.BookingsCreate, BRANCH_B),
      ).toBe(false);
    });

    it('the effective permission set for Branch B excludes the cross-product grant', () => {
      const perms = effectivePermissionsForBranch(entitlements, BRANCH_B);
      // The employee's read set is present in Branch B…
      expect(perms).toContain(Permission.TripsRead);
      // …but the agent's create permission (from Branch A) is not.
      expect(perms).not.toContain(Permission.BookingsCreate);
    });
  });

  describe('point 2 — a permission granted in both branches works in both', () => {
    // Two AGENT memberships, one per branch: bookings.create is granted in each.
    const agentB = membership(MembershipRole.Agent, { id: 'A2', branchId: BRANCH_B });
    const entitlements = resolveEntitlements([agentA, agentB]);

    it('bookings.create is exercisable in each branch that granted it', () => {
      expect(
        canExercisePermissionInBranch(entitlements, Permission.BookingsCreate, BRANCH_A),
      ).toBe(true);
      expect(
        canExercisePermissionInBranch(entitlements, Permission.BookingsCreate, BRANCH_B),
      ).toBe(true);
    });

    it('a shared read permission is present in both branches too', () => {
      expect(effectivePermissionsForBranch(entitlements, BRANCH_A)).toContain(
        Permission.TripsRead,
      );
      expect(effectivePermissionsForBranch(entitlements, BRANCH_B)).toContain(
        Permission.TripsRead,
      );
    });
  });

  describe('point 3 — company-wide only for a genuinely company-wide role', () => {
    it('a manager reaches every branch (company-wide authority)', () => {
      const entitlements = resolveEntitlements([
        membership(MembershipRole.CompanyManager, { id: 'M' }),
      ]);
      // The manager's grants apply in any branch, including one never named.
      expect(
        canExercisePermissionInBranch(entitlements, Permission.MembershipsRead, 'any-branch'),
      ).toBe(true);
      expect(effectivePermissionsForBranch(entitlements, 'any-branch')).toContain(
        Permission.BookingsCreate,
      );
    });

    it('an agent’s permission does NOT become company-wide', () => {
      const entitlements = resolveEntitlements([agentA]);
      // Reachable in its own branch…
      expect(
        canExercisePermissionInBranch(entitlements, Permission.BookingsCreate, BRANCH_A),
      ).toBe(true);
      // …but not in any other branch (no company-wide promotion).
      expect(
        canExercisePermissionInBranch(entitlements, Permission.BookingsCreate, 'other-branch'),
      ).toBe(false);
      expect(effectivePermissionsForBranch(entitlements, 'other-branch')).toEqual([]);
    });
  });

  describe('point 4 — an inactive membership contributes nothing', () => {
    it('is excluded upstream, so it never appears among entitlements', () => {
      // resolveEntitlements trusts the caller to pass only ACTIVE memberships
      // (the repository filters `is_active`). Given only the active one, the
      // inactive membership’s branch and permissions are simply absent.
      const entitlements = resolveEntitlements([agentA]);
      expect(entitlements).toHaveLength(1);
      expect(
        canExercisePermissionInBranch(entitlements, Permission.BookingsCreate, BRANCH_B),
      ).toBe(false);
    });
  });

  it('yields no permissions for a branch nobody is scoped to (fail closed)', () => {
    const entitlements = resolveEntitlements([agentA, employeeB]);
    expect(effectivePermissionsForBranch(entitlements, 'unknown-branch')).toEqual([]);
  });
});
