import type { AuthorizationContext } from '../authorization-context';
import { Permission } from '../permission.enum';
import { PermissionPolicy } from './permission.policy';

function contextWith(permissions: string[]): AuthorizationContext {
  return {
    userId: 'user-1',
    profileId: 'profile-1',
    companyId: 'company-1',
    membershipId: 'membership-1',
    role: 'manager',
    permissions,
  };
}

describe('PermissionPolicy', () => {
  it('allows when every required permission is granted', () => {
    const policy = new PermissionPolicy([
      Permission.BookingsRead,
      Permission.BookingsCreate,
    ]);
    const result = policy.evaluate(
      contextWith([
        Permission.BookingsRead,
        Permission.BookingsCreate,
        Permission.BookingsCancel,
      ]),
    );
    expect(result).toEqual({ allowed: true });
  });

  it('allows trivially when nothing is required', () => {
    const result = new PermissionPolicy([]).evaluate(contextWith([]));
    expect(result.allowed).toBe(true);
  });

  it('denies and reports the missing permissions when any are absent', () => {
    const policy = new PermissionPolicy([
      Permission.BookingsRead,
      Permission.PaymentsRefund,
    ]);
    const result = policy.evaluate(contextWith([Permission.BookingsRead]));

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('missing_permissions:payments.refund');
    }
  });

  it('denies when the context grants no permissions', () => {
    const result = new PermissionPolicy([Permission.CompaniesRead]).evaluate(
      contextWith([]),
    );
    expect(result.allowed).toBe(false);
  });
});
