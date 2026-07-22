import { ValidationException } from '../../common/validation/validation.exception';
import { resolvePagination } from '../../common/pagination/pagination';
import { resolveEntitlements } from '../identity/entitlements';
import type { IdentityService } from '../identity/identity.service';
import type { MembershipContext, Membership } from '../identity/identity.types';
import { MembershipRole } from '../identity/membership-role';
import { BranchNotFoundError, BranchStateConflictError } from './branch.errors';
import type { Branch } from './branch.types';
import type { BranchesRepository } from './branches.repository';
import { BranchesService } from './branches.service';

const USER = '11111111-1111-1111-1111-111111111111';
const now = new Date('2026-01-01T00:00:00.000Z');

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

function contextFor(memberships: Membership[]): MembershipContext {
  return {
    profile: {
      id: USER,
      fullName: 'Mona',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    companyId: '10',
    memberships,
    permissions: [],
    branchAccess: { kind: 'company-wide' },
    entitlements: resolveEntitlements(memberships),
  };
}

function branch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: '100',
    companyId: '10',
    cityId: '5',
    nameAr: 'فرع',
    nameFr: 'Agence',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mockRepository(): jest.Mocked<BranchesRepository> {
  return {
    listByCompany: jest.fn(),
    listByCompanyAndBranchIds: jest.fn(),
    findInCompany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    transitionActive: jest.fn(),
  };
}

function mockIdentity(): jest.Mocked<
  Pick<IdentityService, 'resolveMembershipContext'>
> {
  return { resolveMembershipContext: jest.fn() };
}

describe('BranchesService', () => {
  let repository: jest.Mocked<BranchesRepository>;
  let identity: jest.Mocked<Pick<IdentityService, 'resolveMembershipContext'>>;
  let service: BranchesService;

  beforeEach(() => {
    repository = mockRepository();
    identity = mockIdentity();
    service = new BranchesService(
      repository,
      identity as unknown as IdentityService,
    );
  });

  describe('listBranches', () => {
    it('returns an empty page for a malformed company id (no query)', async () => {
      await expect(
        service.listBranches(USER, 'not-a-number', resolvePagination()),
      ).resolves.toEqual({ items: [], total: 0 });
      expect(identity.resolveMembershipContext).not.toHaveBeenCalled();
    });

    it('returns an empty page when no membership context resolves', async () => {
      identity.resolveMembershipContext.mockResolvedValue(null);
      await expect(
        service.listBranches(USER, '10', resolvePagination()),
      ).resolves.toEqual({ items: [], total: 0 });
    });

    it('lists all company branches for a company-wide member', async () => {
      identity.resolveMembershipContext.mockResolvedValue(
        contextFor([membership(MembershipRole.CompanyManager)]),
      );
      repository.listByCompany.mockResolvedValue({ items: [branch()], total: 1 });

      await service.listBranches(USER, '10', resolvePagination());

      expect(repository.listByCompany).toHaveBeenCalledWith(
        '10',
        expect.anything(),
      );
      expect(repository.listByCompanyAndBranchIds).not.toHaveBeenCalled();
    });

    it('lists only the entitled branches for a branch-restricted member', async () => {
      identity.resolveMembershipContext.mockResolvedValue(
        contextFor([
          membership(MembershipRole.BranchEmployee, { branchId: '100' }),
        ]),
      );
      repository.listByCompanyAndBranchIds.mockResolvedValue({
        items: [branch()],
        total: 1,
      });

      await service.listBranches(USER, '10', resolvePagination());

      expect(repository.listByCompanyAndBranchIds).toHaveBeenCalledWith(
        '10',
        ['100'],
        expect.anything(),
      );
      expect(repository.listByCompany).not.toHaveBeenCalled();
    });
  });

  describe('getBranch', () => {
    it('throws not-found for malformed ids without querying', async () => {
      await expect(service.getBranch(USER, '10', 'x')).rejects.toBeInstanceOf(
        BranchNotFoundError,
      );
      expect(identity.resolveMembershipContext).not.toHaveBeenCalled();
    });

    it('throws not-found when the caller cannot read the target branch', async () => {
      identity.resolveMembershipContext.mockResolvedValue(
        contextFor([
          membership(MembershipRole.BranchEmployee, { branchId: '100' }),
        ]),
      );
      // Branch 200 is not the employee's branch -> not visible.
      await expect(
        service.getBranch(USER, '10', '200'),
      ).rejects.toBeInstanceOf(BranchNotFoundError);
      expect(repository.findInCompany).not.toHaveBeenCalled();
    });

    it('returns the branch when readable and present', async () => {
      identity.resolveMembershipContext.mockResolvedValue(
        contextFor([membership(MembershipRole.CompanyManager)]),
      );
      repository.findInCompany.mockResolvedValue(branch({ id: '200' }));
      await expect(service.getBranch(USER, '10', '200')).resolves.toMatchObject({
        id: '200',
      });
      expect(repository.findInCompany).toHaveBeenCalledWith('10', '200');
    });

    it('throws not-found when readable but absent in the company', async () => {
      identity.resolveMembershipContext.mockResolvedValue(
        contextFor([membership(MembershipRole.CompanyManager)]),
      );
      repository.findInCompany.mockResolvedValue(null);
      await expect(service.getBranch(USER, '10', '200')).rejects.toBeInstanceOf(
        BranchNotFoundError,
      );
    });
  });

  describe('updateBranch', () => {
    it('rejects an empty update with a validation error', async () => {
      await expect(service.updateBranch('10', '100', {})).rejects.toBeInstanceOf(
        ValidationException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('throws not-found when no row is updated', async () => {
      repository.update.mockResolvedValue(null);
      await expect(
        service.updateBranch('10', '100', { nameFr: 'New' }),
      ).rejects.toBeInstanceOf(BranchNotFoundError);
    });
  });

  describe('setBranchActive', () => {
    it('returns the branch when the transition applies', async () => {
      repository.transitionActive.mockResolvedValue(branch({ isActive: false }));
      await expect(
        service.setBranchActive('10', '100', false),
      ).resolves.toMatchObject({ isActive: false });
    });

    it('conflicts when the branch is already in the target state', async () => {
      repository.transitionActive.mockResolvedValue(null);
      repository.findInCompany.mockResolvedValue(branch());
      await expect(
        service.setBranchActive('10', '100', true),
      ).rejects.toBeInstanceOf(BranchStateConflictError);
    });

    it('is not-found when the branch does not exist in the company', async () => {
      repository.transitionActive.mockResolvedValue(null);
      repository.findInCompany.mockResolvedValue(null);
      await expect(
        service.setBranchActive('10', '100', true),
      ).rejects.toBeInstanceOf(BranchNotFoundError);
    });
  });

  describe('createBranch', () => {
    it('delegates to the repository with the tenant company id', async () => {
      repository.create.mockResolvedValue(branch());
      await service.createBranch('10', {
        cityId: '5',
        nameAr: 'فرع',
        nameFr: 'Agence',
      });
      expect(repository.create).toHaveBeenCalledWith('10', {
        cityId: '5',
        nameAr: 'فرع',
        nameFr: 'Agence',
      });
    });
  });
});
