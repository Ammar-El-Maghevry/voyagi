import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { Permission } from '../authorization/permission.enum';
import { DatabaseAuthorizationContextResolver } from './database-authorization-context.resolver';
import type { IdentityService } from './identity.service';
import type { MembershipContext, Profile } from './identity.types';
import { MembershipRole } from './membership-role';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const principal = { userId: USER_ID } as AuthenticatedPrincipal;
const now = new Date('2026-01-01T00:00:00.000Z');

const activeProfile: Profile = {
  id: USER_ID,
  fullName: 'Amina',
  isActive: true,
  createdAt: now,
  updatedAt: now,
};

function serviceMock(): jest.Mocked<
  Pick<IdentityService, 'findActiveProfile' | 'resolveMembershipContext'>
> {
  return {
    findActiveProfile: jest.fn(),
    resolveMembershipContext: jest.fn(),
  };
}

describe('DatabaseAuthorizationContextResolver', () => {
  let identity: ReturnType<typeof serviceMock>;
  let resolver: DatabaseAuthorizationContextResolver;

  beforeEach(() => {
    identity = serviceMock();
    resolver = new DatabaseAuthorizationContextResolver(
      identity as unknown as IdentityService,
    );
  });

  it('returns a profile-only, permission-less context when no company is targeted', async () => {
    identity.findActiveProfile.mockResolvedValue(activeProfile);

    const context = await resolver.resolve({
      principal,
      requestId: 'req-1',
    });

    expect(context).toEqual({
      userId: USER_ID,
      profileId: USER_ID,
      permissions: [],
    });
    expect(identity.resolveMembershipContext).not.toHaveBeenCalled();
  });

  it('returns null when no active profile exists', async () => {
    identity.findActiveProfile.mockResolvedValue(null);

    await expect(
      resolver.resolve({ principal, requestId: 'req-1' }),
    ).resolves.toBeNull();
  });

  function membership(id: string, role: MembershipRole): MembershipContext['memberships'][number] {
    return {
      id,
      userId: USER_ID,
      companyId: '10',
      role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  it('surfaces membershipId/role for a single active membership', async () => {
    const membershipContext: MembershipContext = {
      profile: activeProfile,
      companyId: '10',
      memberships: [membership('7', MembershipRole.CompanyManager)],
      permissions: [Permission.MembershipsRead],
      branchAccess: { kind: 'company-wide' },
      // The resolver only reads the permission union and single-membership id/role.
      entitlements: [],
    };
    identity.resolveMembershipContext.mockResolvedValue(membershipContext);

    const context = await resolver.resolve({
      principal,
      companyId: '10',
      requestId: 'req-1',
    });

    expect(context).toEqual({
      userId: USER_ID,
      profileId: USER_ID,
      companyId: '10',
      membershipId: '7',
      role: MembershipRole.CompanyManager,
      permissions: [Permission.MembershipsRead],
    });
  });

  it('leaves membershipId/role undefined when several memberships are ambiguous', async () => {
    const membershipContext: MembershipContext = {
      profile: activeProfile,
      companyId: '10',
      memberships: [
        membership('3', MembershipRole.BranchEmployee),
        membership('9', MembershipRole.Agent),
      ],
      permissions: [Permission.BookingsCreate],
      branchAccess: { kind: 'restricted', branchIds: ['5', '7'] },
      entitlements: [],
    };
    identity.resolveMembershipContext.mockResolvedValue(membershipContext);

    const context = await resolver.resolve({
      principal,
      companyId: '10',
      requestId: 'req-1',
    });

    expect(context).toEqual({
      userId: USER_ID,
      profileId: USER_ID,
      companyId: '10',
      membershipId: undefined,
      role: undefined,
      permissions: [Permission.BookingsCreate],
    });
  });

  it('returns null (fail closed) when no membership context resolves', async () => {
    identity.resolveMembershipContext.mockResolvedValue(null);

    await expect(
      resolver.resolve({ principal, companyId: '10', requestId: 'req-1' }),
    ).resolves.toBeNull();
  });

  it('propagates a database failure rather than denying', async () => {
    identity.resolveMembershipContext.mockRejectedValue(
      new Error('db unavailable'),
    );

    await expect(
      resolver.resolve({ principal, companyId: '10', requestId: 'req-1' }),
    ).rejects.toThrow('db unavailable');
  });
});
