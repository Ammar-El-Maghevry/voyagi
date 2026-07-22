import {
  isMembershipRole,
  parseMembershipRole,
} from './membership-role';

describe('membership-role', () => {
  it('recognizes every database enum label', () => {
    for (const role of [
      'SUPER_ADMIN',
      'COMPANY_MANAGER',
      'BRANCH_EMPLOYEE',
      'AGENT',
      'PASSENGER',
    ]) {
      expect(isMembershipRole(role)).toBe(true);
      expect(parseMembershipRole(role)).toBe(role);
    }
  });

  it('maps an unknown role to null (fail closed)', () => {
    expect(parseMembershipRole('OWNER')).toBeNull();
    expect(parseMembershipRole('super_admin')).toBeNull();
    expect(isMembershipRole('OWNER')).toBe(false);
  });
});
