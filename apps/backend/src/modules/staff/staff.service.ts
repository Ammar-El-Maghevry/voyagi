import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { ValidationException } from '../../common/validation/validation.exception';
import { parsePositiveBigInt } from '../identity/identifier.util';
import {
  StaffMemberNotFoundError,
  StaffMemberStateConflictError,
} from './staff.errors';
import {
  STAFF_REPOSITORY,
  type PagedResult,
  type StaffRepository,
} from './staff.repository';
import type {
  StaffMember,
  StaffMemberCreate,
  StaffMemberUpdate,
} from './staff.types';

const EMPTY_PAGE: PagedResult<StaffMember> = { items: [], total: 0 };

/**
 * Application service for staff members.
 *
 * Staff are company-scoped: `staff.read` (any active member) governs reads and
 * the company-wide `staff.manage` governs writes, both enforced by the guard.
 * There is no branch dimension, so no branch-entitlement narrowing applies here.
 * Company/staff ids are validated before any query so a malformed value fails
 * closed (`404`) instead of reaching the database as a `22P02` → `500`.
 */
@Injectable()
export class StaffService {
  constructor(
    @Inject(STAFF_REPOSITORY)
    private readonly repository: StaffRepository,
  ) {}

  /** A page of the company's staff members. */
  async listStaff(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<StaffMember>> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    if (normalizedCompanyId === null) {
      return EMPTY_PAGE;
    }
    return this.repository.listByCompany(normalizedCompanyId, pagination);
  }

  /** A single staff member within the company, or {@link StaffMemberNotFoundError}. */
  async getStaffMember(
    companyId: string,
    staffMemberId: string,
  ): Promise<StaffMember> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    const normalizedStaffId = parsePositiveBigInt(staffMemberId);
    if (normalizedCompanyId === null || normalizedStaffId === null) {
      throw new StaffMemberNotFoundError();
    }
    const staffMember = await this.repository.findInCompany(
      normalizedCompanyId,
      normalizedStaffId,
    );
    if (!staffMember) {
      throw new StaffMemberNotFoundError();
    }
    return staffMember;
  }

  /** Create a staff member for the company (requires `staff.manage`, enforced upstream). */
  async createStaffMember(
    companyId: string,
    input: StaffMemberCreate,
  ): Promise<StaffMember> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    if (normalizedCompanyId === null) {
      throw new StaffMemberNotFoundError();
    }
    return this.repository.create(normalizedCompanyId, input);
  }

  /** Update a staff member's fields within the company. */
  async updateStaffMember(
    companyId: string,
    staffMemberId: string,
    input: StaffMemberUpdate,
  ): Promise<StaffMember> {
    if (
      input.fullName === undefined &&
      input.staffType === undefined &&
      input.phone === undefined
    ) {
      throw new ValidationException({
        body: ['At least one updatable field must be provided.'],
      });
    }
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    const normalizedStaffId = parsePositiveBigInt(staffMemberId);
    if (normalizedCompanyId === null || normalizedStaffId === null) {
      throw new StaffMemberNotFoundError();
    }
    const staffMember = await this.repository.update(
      normalizedCompanyId,
      normalizedStaffId,
      input,
    );
    if (!staffMember) {
      throw new StaffMemberNotFoundError();
    }
    return staffMember;
  }

  /** Activate or deactivate a staff member (atomic transition; no-op → conflict). */
  async setStaffMemberActive(
    companyId: string,
    staffMemberId: string,
    target: boolean,
  ): Promise<StaffMember> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    const normalizedStaffId = parsePositiveBigInt(staffMemberId);
    if (normalizedCompanyId === null || normalizedStaffId === null) {
      throw new StaffMemberNotFoundError();
    }
    const transitioned = await this.repository.transitionActive(
      normalizedCompanyId,
      normalizedStaffId,
      target,
    );
    if (transitioned) {
      return transitioned;
    }
    const existing = await this.repository.findInCompany(
      normalizedCompanyId,
      normalizedStaffId,
    );
    if (existing) {
      throw new StaffMemberStateConflictError(target);
    }
    throw new StaffMemberNotFoundError();
  }
}
