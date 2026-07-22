import { ValidationException } from '../../common/validation/validation.exception';
import { resolvePagination } from '../../common/pagination/pagination';
import { Permission } from '../authorization/permission.enum';
import {
  canExercisePermissionInBranch,
  effectivePermissionsForBranch,
} from './entitlements';
import { MembershipNotFoundError, ProfileNotFoundError } from './identity.errors';
import type { IdentityRepository } from './identity.repository';
import { IdentityService } from './identity.service';
import type { Membership, MembershipView, Profile } from './identity.types';
import { MembershipRole } from './membership-role';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const now = new Date('2026-01-01T00:00:00.000Z');

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: USER_ID,
    fullName: 'Amina',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function membership(
  role: MembershipRole,
  overrides: Partial<Membership> = {},
): Membership {
  return {
    id: '1',
    userId: USER_ID,
    companyId: '10',
    role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mockRepository(): jest.Mocked<IdentityRepository> {
  return {
    findProfileByUserId: jest.fn(),
    updateProfile: jest.fn(),
    findActiveMembershipsForCompany: jest.fn(),
    listMembershipsForUser: jest.fn(),
    listCompanyMemberships: jest.fn(),
    findCompanyMembership: jest.fn(),
  };
}

describe('IdentityService', () => {
  let repository: jest.Mocked<IdentityRepository>;
  let service: IdentityService;

  beforeEach(() => {
    repository = mockRepository();
    service = new IdentityService(repository);
  });

  describe('getProfile', () => {
    it('returns the profile when it exists', async () => {
      repository.findProfileByUserId.mockResolvedValue(profile());
      await expect(service.getProfile(USER_ID)).resolves.toMatchObject({
        id: USER_ID,
      });
    });

    it('throws ProfileNotFoundError when absent', async () => {
      repository.findProfileByUserId.mockResolvedValue(null);
      await expect(service.getProfile(USER_ID)).rejects.toBeInstanceOf(
        ProfileNotFoundError,
      );
    });

    it('does not query for a non-UUID subject', async () => {
      await expect(service.getProfile('user-123')).rejects.toBeInstanceOf(
        ProfileNotFoundError,
      );
      expect(repository.findProfileByUserId).not.toHaveBeenCalled();
    });
  });

  describe('updateProfile', () => {
    it('rejects an empty update with a validation error', async () => {
      await expect(service.updateProfile(USER_ID, {})).rejects.toBeInstanceOf(
        ValidationException,
      );
      expect(repository.updateProfile).not.toHaveBeenCalled();
    });

    it('throws ProfileNotFoundError when no row is updated', async () => {
      repository.updateProfile.mockResolvedValue(null);
      await expect(
        service.updateProfile(USER_ID, { fullName: 'New' }),
      ).rejects.toBeInstanceOf(ProfileNotFoundError);
    });

    it('returns the updated profile', async () => {
      repository.updateProfile.mockResolvedValue(profile({ fullName: 'New' }));
      await expect(
        service.updateProfile(USER_ID, { fullName: 'New' }),
      ).resolves.toMatchObject({ fullName: 'New' });
      expect(repository.updateProfile).toHaveBeenCalledWith(USER_ID, {
        fullName: 'New',
      });
    });
  });

  describe('findActiveProfile', () => {
    it('returns null for a non-UUID subject without querying', async () => {
      await expect(service.findActiveProfile('user-123')).resolves.toBeNull();
      expect(repository.findProfileByUserId).not.toHaveBeenCalled();
    });

    it('returns null for a disabled profile', async () => {
      repository.findProfileByUserId.mockResolvedValue(
        profile({ isActive: false }),
      );
      await expect(service.findActiveProfile(USER_ID)).resolves.toBeNull();
    });

    it('returns an active profile', async () => {
      repository.findProfileByUserId.mockResolvedValue(profile());
      await expect(service.findActiveProfile(USER_ID)).resolves.toMatchObject({
        id: USER_ID,
      });
    });
  });

  describe('resolveMembershipContext', () => {
    it('returns null when the profile is missing or inactive', async () => {
      repository.findProfileByUserId.mockResolvedValue(null);
      await expect(
        service.resolveMembershipContext(USER_ID, '10'),
      ).resolves.toBeNull();
      expect(
        repository.findActiveMembershipsForCompany,
      ).not.toHaveBeenCalled();
    });

    it('returns null for a malformed company id (no query)', async () => {
      repository.findProfileByUserId.mockResolvedValue(profile());
      await expect(
        service.resolveMembershipContext(USER_ID, 'not-a-number'),
      ).resolves.toBeNull();
      expect(
        repository.findActiveMembershipsForCompany,
      ).not.toHaveBeenCalled();
    });

    it('returns null when there is no active membership in the company', async () => {
      repository.findProfileByUserId.mockResolvedValue(profile());
      repository.findActiveMembershipsForCompany.mockResolvedValue([]);
      await expect(
        service.resolveMembershipContext(USER_ID, '10'),
      ).resolves.toBeNull();
    });

    it('resolves permissions and branch access for a single manager membership', async () => {
      repository.findProfileByUserId.mockResolvedValue(profile());
      repository.findActiveMembershipsForCompany.mockResolvedValue([
        membership(MembershipRole.CompanyManager, { id: '7' }),
      ]);

      const context = await service.resolveMembershipContext(USER_ID, '10');

      expect(context).not.toBeNull();
      expect(context?.companyId).toBe('10');
      expect(context?.memberships.map((m) => m.id)).toEqual(['7']);
      expect(context?.permissions).toContain(Permission.MembershipsRead);
      expect(context?.branchAccess).toEqual({ kind: 'company-wide' });
      // No invented "primary membership" is exposed.
      expect(context).not.toHaveProperty('primaryMembership');
    });

    it('unions permissions across several memberships without privilege expansion', async () => {
      repository.findProfileByUserId.mockResolvedValue(profile());
      const memberships = [
        membership(MembershipRole.Agent, { id: '9', branchId: '7' }),
        membership(MembershipRole.BranchEmployee, { id: '3', branchId: '5' }),
      ];
      repository.findActiveMembershipsForCompany.mockResolvedValue(memberships);

      const context = await service.resolveMembershipContext(USER_ID, '10');

      // All active memberships are retained (no single one is selected).
      expect(context?.memberships).toHaveLength(2);
      // Union of employee + agent = read set + the agent's bookings.create.
      expect(context?.permissions).toContain(Permission.BookingsCreate);
      // Not granted by either component role -> not present (no expansion).
      expect(context?.permissions).not.toContain(Permission.TicketsIssue);
      expect(context?.permissions).not.toContain(Permission.MembershipsRead);
      // Branch access is the union of both branch-scoped grants.
      expect(context?.branchAccess).toEqual({
        kind: 'restricted',
        branchIds: ['7', '5'],
      });

      // Entitlements keep each permission coupled to its own membership's branch:
      // the agent's bookings.create (branch 7) does not cross into the employee's
      // branch (5), even though both appear in the flat unions above.
      const entitlements = context?.entitlements ?? [];
      expect(entitlements).toHaveLength(2);
      expect(
        canExercisePermissionInBranch(entitlements, Permission.BookingsCreate, '7'),
      ).toBe(true);
      expect(
        canExercisePermissionInBranch(entitlements, Permission.BookingsCreate, '5'),
      ).toBe(false);
      expect(effectivePermissionsForBranch(entitlements, '5')).not.toContain(
        Permission.BookingsCreate,
      );
    });

    it('propagates a database failure instead of denying access', async () => {
      repository.findProfileByUserId.mockResolvedValue(profile());
      repository.findActiveMembershipsForCompany.mockRejectedValue(
        new Error('connection reset'),
      );
      await expect(
        service.resolveMembershipContext(USER_ID, '10'),
      ).rejects.toThrow('connection reset');
    });
  });

  describe('listMyCompanies', () => {
    it('returns an empty page for a non-UUID subject', async () => {
      await expect(
        service.listMyCompanies('user-123', resolvePagination()),
      ).resolves.toEqual({ items: [], total: 0 });
      expect(repository.listMembershipsForUser).not.toHaveBeenCalled();
    });

    it('delegates to the repository for a valid subject', async () => {
      repository.listMembershipsForUser.mockResolvedValue({
        items: [],
        total: 0,
      });
      await service.listMyCompanies(USER_ID, resolvePagination());
      expect(repository.listMembershipsForUser).toHaveBeenCalled();
    });
  });

  describe('listCompanyMemberships', () => {
    it('returns an empty page for a malformed company id', async () => {
      await expect(
        service.listCompanyMemberships('x', resolvePagination()),
      ).resolves.toEqual({ items: [], total: 0 });
      expect(repository.listCompanyMemberships).not.toHaveBeenCalled();
    });
  });

  describe('getCompanyMembership', () => {
    const view: MembershipView = {
      ...membership(MembershipRole.Agent, { id: '4', branchId: '5' }),
      companyName: 'Voyagi',
      memberName: 'Amina',
    };

    it('throws MembershipNotFoundError for malformed ids without querying', async () => {
      await expect(
        service.getCompanyMembership('10', 'x'),
      ).rejects.toBeInstanceOf(MembershipNotFoundError);
      expect(repository.findCompanyMembership).not.toHaveBeenCalled();
    });

    it('throws MembershipNotFoundError when not present in the company', async () => {
      repository.findCompanyMembership.mockResolvedValue(null);
      await expect(
        service.getCompanyMembership('10', '4'),
      ).rejects.toBeInstanceOf(MembershipNotFoundError);
    });

    it('returns the membership when found in the company', async () => {
      repository.findCompanyMembership.mockResolvedValue(view);
      await expect(
        service.getCompanyMembership('10', '4'),
      ).resolves.toMatchObject({ id: '4', memberName: 'Amina' });
    });
  });
});
