import { resolveBranchAccess } from './branch-access';
import type { Membership } from './identity.types';
import { MembershipRole } from './membership-role';

function membership(
  role: MembershipRole,
  branchId?: string,
): Membership {
  return {
    id: '1',
    userId: 'u',
    companyId: '10',
    branchId,
    role,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('resolveBranchAccess', () => {
  it('is company-wide for a company manager', () => {
    expect(resolveBranchAccess([membership(MembershipRole.CompanyManager)])).toEqual(
      { kind: 'company-wide' },
    );
  });

  it('is company-wide for a super admin', () => {
    expect(resolveBranchAccess([membership(MembershipRole.SuperAdmin)])).toEqual(
      { kind: 'company-wide' },
    );
  });

  it('is company-wide when any membership is company-wide', () => {
    expect(
      resolveBranchAccess([
        membership(MembershipRole.BranchEmployee, '5'),
        membership(MembershipRole.CompanyManager),
      ]),
    ).toEqual({ kind: 'company-wide' });
  });

  it('restricts to the union of branch-scoped memberships', () => {
    const access = resolveBranchAccess([
      membership(MembershipRole.BranchEmployee, '5'),
      membership(MembershipRole.Agent, '7'),
      membership(MembershipRole.BranchEmployee, '5'),
    ]);
    expect(access.kind).toBe('restricted');
    expect(access.kind === 'restricted' && [...access.branchIds].sort()).toEqual([
      '5',
      '7',
    ]);
  });

  it('is none for a branch-scoped role with no branch, or a passenger', () => {
    expect(resolveBranchAccess([membership(MembershipRole.BranchEmployee)])).toEqual(
      { kind: 'none' },
    );
    expect(resolveBranchAccess([membership(MembershipRole.Passenger)])).toEqual({
      kind: 'none',
    });
    expect(resolveBranchAccess([])).toEqual({ kind: 'none' });
  });
});
