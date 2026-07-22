import { ValidationException } from '../../common/validation/validation.exception';
import { resolvePagination } from '../../common/pagination/pagination';
import { StaffType } from './staff-type';
import {
  StaffMemberNotFoundError,
  StaffMemberStateConflictError,
} from './staff.errors';
import type { StaffRepository } from './staff.repository';
import { StaffService } from './staff.service';
import type { StaffMember } from './staff.types';

const now = new Date('2026-01-01T00:00:00.000Z');

function staff(overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    id: '7',
    companyId: '10',
    fullName: 'Sidi Driver',
    staffType: StaffType.Driver,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mockRepository(): jest.Mocked<StaffRepository> {
  return {
    listByCompany: jest.fn(),
    findInCompany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    transitionActive: jest.fn(),
  };
}

describe('StaffService', () => {
  let repository: jest.Mocked<StaffRepository>;
  let service: StaffService;

  beforeEach(() => {
    repository = mockRepository();
    service = new StaffService(repository);
  });

  describe('listStaff', () => {
    it('returns an empty page for a malformed company id', async () => {
      await expect(
        service.listStaff('x', resolvePagination()),
      ).resolves.toEqual({ items: [], total: 0 });
      expect(repository.listByCompany).not.toHaveBeenCalled();
    });

    it('delegates a valid company id to the repository', async () => {
      repository.listByCompany.mockResolvedValue({ items: [], total: 0 });
      await service.listStaff('10', resolvePagination());
      expect(repository.listByCompany).toHaveBeenCalledWith('10', expect.anything());
    });
  });

  describe('getStaffMember', () => {
    it('throws not-found for malformed ids without querying', async () => {
      await expect(service.getStaffMember('10', 'x')).rejects.toBeInstanceOf(
        StaffMemberNotFoundError,
      );
      expect(repository.findInCompany).not.toHaveBeenCalled();
    });

    it('throws not-found when absent in the company', async () => {
      repository.findInCompany.mockResolvedValue(null);
      await expect(service.getStaffMember('10', '7')).rejects.toBeInstanceOf(
        StaffMemberNotFoundError,
      );
    });

    it('returns the staff member when found', async () => {
      repository.findInCompany.mockResolvedValue(staff());
      await expect(service.getStaffMember('10', '7')).resolves.toMatchObject({
        id: '7',
      });
    });
  });

  describe('updateStaffMember', () => {
    it('rejects an empty update', async () => {
      await expect(
        service.updateStaffMember('10', '7', {}),
      ).rejects.toBeInstanceOf(ValidationException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('throws not-found when no row is updated', async () => {
      repository.update.mockResolvedValue(null);
      await expect(
        service.updateStaffMember('10', '7', { fullName: 'New' }),
      ).rejects.toBeInstanceOf(StaffMemberNotFoundError);
    });
  });

  describe('setStaffMemberActive', () => {
    it('returns the staff member when the transition applies', async () => {
      repository.transitionActive.mockResolvedValue(staff({ isActive: false }));
      await expect(
        service.setStaffMemberActive('10', '7', false),
      ).resolves.toMatchObject({ isActive: false });
    });

    it('conflicts when already in the target state', async () => {
      repository.transitionActive.mockResolvedValue(null);
      repository.findInCompany.mockResolvedValue(staff());
      await expect(
        service.setStaffMemberActive('10', '7', true),
      ).rejects.toBeInstanceOf(StaffMemberStateConflictError);
    });

    it('is not-found when the staff member does not exist', async () => {
      repository.transitionActive.mockResolvedValue(null);
      repository.findInCompany.mockResolvedValue(null);
      await expect(
        service.setStaffMemberActive('10', '7', true),
      ).rejects.toBeInstanceOf(StaffMemberNotFoundError);
    });
  });
});
