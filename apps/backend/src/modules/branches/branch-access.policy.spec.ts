import { Permission } from '../authorization/permission.enum';
import { resolveEntitlements, type Entitlement } from '../identity/entitlements';
import type { Membership } from '../identity/identity.types';
import { MembershipRole } from '../identity/membership-role';
import { canReadBranch, readableBranchScope } from './branch-access.policy';

const USER = '11111111-1111-1111-1111-111111111111';
const now = new Date('2026-01-01T00:00:00.000Z');
const BRANCH_A = '100';
const BRANCH_B = '200';

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

describe('branch-access policy (branches.read, entitlement-coupled)', () => {
  describe('readableBranchScope', () => {
    it('gives a company-wide reader (manager) access to all branches', () => {
      const entitlements = resolveEntitlements([
        membership(MembershipRole.CompanyManager, { id: 'M' }),
      ]);
      expect(readableBranchScope(entitlements)).toEqual({ kind: 'all' });
    });

    it('restricts a branch employee to their own branch', () => {
      const entitlements = resolveEntitlements([
        membership(MembershipRole.BranchEmployee, { id: 'E', branchId: BRANCH_A }),
      ]);
      expect(readableBranchScope(entitlements)).toEqual({
        kind: 'restricted',
        branchIds: [BRANCH_A],
      });
    });

    it('unions the branches of several branch-scoped readers', () => {
      const entitlements = resolveEntitlements([
        membership(MembershipRole.BranchEmployee, { id: 'E', branchId: BRANCH_A }),
        membership(MembershipRole.Agent, { id: 'G', branchId: BRANCH_B }),
      ]);
      const scope = readableBranchScope(entitlements);
      expect(scope.kind).toBe('restricted');
      const ids =
        scope.kind === 'restricted' ? [...scope.branchIds].sort() : [];
      expect(ids).toEqual([BRANCH_A, BRANCH_B].sort());
    });

    it('yields none when no membership grants branches.read', () => {
      const entitlements = resolveEntitlements([
        membership(MembershipRole.Passenger, { id: 'P' }),
      ]);
      expect(readableBranchScope(entitlements)).toEqual({ kind: 'none' });
    });
  });

  describe('canReadBranch', () => {
    const entitlements = resolveEntitlements([
      membership(MembershipRole.BranchEmployee, { id: 'E', branchId: BRANCH_A }),
    ]);

    it('allows reading the branch the membership is scoped to', () => {
      expect(canReadBranch(entitlements, BRANCH_A)).toBe(true);
    });

    it('denies reading a different branch (isolation)', () => {
      expect(canReadBranch(entitlements, BRANCH_B)).toBe(false);
    });
  });

  describe('no permission/branch cross-product (the Phase 5 defect must not return)', () => {
    // Synthetic entitlements that a naive flat-union check would mishandle:
    //   A: grants branches.read, scoped to Branch A.
    //   B: grants NO branches.read, but reaches Branch B.
    // Flat union = { has branches.read } × { reaches A, B } would wrongly allow
    // reading Branch B. The coupled policy must not.
    const readerInA: Entitlement = {
      membership: membership(MembershipRole.BranchEmployee, {
        id: 'A',
        branchId: BRANCH_A,
      }),
      permissions: [Permission.BranchesRead],
      branchAccess: { kind: 'restricted', branchIds: [BRANCH_A] },
    };
    const nonReaderInB: Entitlement = {
      membership: membership(MembershipRole.Passenger, { id: 'B' }),
      permissions: [], // deliberately no branches.read
      branchAccess: { kind: 'restricted', branchIds: [BRANCH_B] },
    };
    const entitlements = [readerInA, nonReaderInB];

    it('does not admit Branch B, whose only entitlement lacks branches.read', () => {
      expect(canReadBranch(entitlements, BRANCH_B)).toBe(false);
      expect(canReadBranch(entitlements, BRANCH_A)).toBe(true);
    });

    it('scopes readable branches to A only — B is never pulled in by the union', () => {
      expect(readableBranchScope(entitlements)).toEqual({
        kind: 'restricted',
        branchIds: [BRANCH_A],
      });
    });
  });
});
