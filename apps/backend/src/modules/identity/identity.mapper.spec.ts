import {
  toMembership,
  toMembershipView,
  toProfile,
  type MembershipRow,
  type MembershipViewRow,
  type ProfileRow,
} from './identity.mapper';
import { MembershipRole } from './membership-role';

const now = new Date('2026-01-01T00:00:00.000Z');

const profileRow: ProfileRow = {
  id: '11111111-1111-1111-1111-111111111111',
  full_name: 'Amina',
  phone_number: '+22212345678',
  is_active: true,
  created_at: now,
  updated_at: now,
};

const membershipRow: MembershipRow = {
  id: '42',
  user_id: profileRow.id,
  company_id: '10',
  branch_id: '5',
  role: 'BRANCH_EMPLOYEE',
  is_active: true,
  created_at: now,
  updated_at: now,
};

describe('identity.mapper', () => {
  it('maps a profile row, converting a null phone to undefined', () => {
    expect(toProfile(profileRow)).toEqual({
      id: profileRow.id,
      fullName: 'Amina',
      phoneNumber: '+22212345678',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    expect(toProfile({ ...profileRow, phone_number: null }).phoneNumber).toBeUndefined();
  });

  it('maps a membership row with a known role', () => {
    expect(toMembership(membershipRow)).toMatchObject({
      id: '42',
      companyId: '10',
      branchId: '5',
      role: MembershipRole.BranchEmployee,
      isActive: true,
    });
  });

  it('drops a company-wide role branch id to undefined', () => {
    const manager = toMembership({
      ...membershipRow,
      role: 'COMPANY_MANAGER',
      branch_id: null,
    });
    expect(manager?.branchId).toBeUndefined();
  });

  it('returns null for an unknown role (fail closed)', () => {
    expect(toMembership({ ...membershipRow, role: 'OWNER' })).toBeNull();
  });

  it('maps a membership view with company and member names', () => {
    const viewRow: MembershipViewRow = {
      ...membershipRow,
      company_name: 'Voyagi Transit',
      member_name: 'Amina',
    };
    expect(toMembershipView(viewRow)).toMatchObject({
      companyName: 'Voyagi Transit',
      memberName: 'Amina',
      role: MembershipRole.BranchEmployee,
    });
  });

  it('returns null for a view row with an unknown role', () => {
    const viewRow: MembershipViewRow = {
      ...membershipRow,
      role: 'OWNER',
      company_name: 'Voyagi Transit',
      member_name: 'Amina',
    };
    expect(toMembershipView(viewRow)).toBeNull();
  });
});
