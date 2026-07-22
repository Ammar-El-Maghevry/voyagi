import type { ResolvedPagination } from '../../src/common/pagination/pagination';
import type {
  PagedResult,
  StaffRepository,
} from '../../src/modules/staff/staff.repository';
import type { StaffType } from '../../src/modules/staff/staff-type';
import type {
  StaffMember,
  StaffMemberCreate,
  StaffMemberUpdate,
} from '../../src/modules/staff/staff.types';

interface SeedStaff {
  id: string;
  companyId: string;
  fullName: string;
  staffType: StaffType;
  phone?: string;
  isActive?: boolean;
}

/**
 * In-memory {@link StaffRepository} for e2e tests, preserving the SQL adapter's
 * company scoping and atomic activation transition semantics.
 */
export class InMemoryStaffRepository implements StaffRepository {
  private readonly staff: StaffMember[] = [];
  private sequence = 2000;
  private failWith: Error | null = null;

  addStaff(seed: SeedStaff): void {
    const now = new Date('2026-01-01T00:00:00.000Z');
    this.staff.push({
      id: seed.id,
      companyId: seed.companyId,
      fullName: seed.fullName,
      staffType: seed.staffType,
      phone: seed.phone,
      isActive: seed.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });
  }

  failNextWith(error: Error): void {
    this.failWith = error;
  }

  private maybeFail(): void {
    if (this.failWith) {
      const error = this.failWith;
      this.failWith = null;
      throw error;
    }
  }

  listByCompany(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<StaffMember>> {
    this.maybeFail();
    const all = this.staff.filter((s) => s.companyId === companyId);
    const page = all.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );
    return Promise.resolve({ items: page, total: all.length });
  }

  findInCompany(
    companyId: string,
    staffMemberId: string,
  ): Promise<StaffMember | null> {
    this.maybeFail();
    return Promise.resolve(
      this.staff.find(
        (s) => s.id === staffMemberId && s.companyId === companyId,
      ) ?? null,
    );
  }

  create(companyId: string, input: StaffMemberCreate): Promise<StaffMember> {
    this.maybeFail();
    const now = new Date();
    const member: StaffMember = {
      id: String(++this.sequence),
      companyId,
      fullName: input.fullName,
      phone: input.phone,
      staffType: input.staffType,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    this.staff.push(member);
    return Promise.resolve(member);
  }

  update(
    companyId: string,
    staffMemberId: string,
    input: StaffMemberUpdate,
  ): Promise<StaffMember | null> {
    this.maybeFail();
    const index = this.staff.findIndex(
      (s) => s.id === staffMemberId && s.companyId === companyId,
    );
    if (index === -1) {
      return Promise.resolve(null);
    }
    const current = this.staff[index];
    const next: StaffMember = {
      ...current,
      fullName: input.fullName ?? current.fullName,
      staffType: input.staffType ?? current.staffType,
      phone:
        input.phone === undefined
          ? current.phone
          : (input.phone ?? undefined),
      updatedAt: new Date(),
    };
    this.staff[index] = next;
    return Promise.resolve(next);
  }

  transitionActive(
    companyId: string,
    staffMemberId: string,
    target: boolean,
  ): Promise<StaffMember | null> {
    this.maybeFail();
    const index = this.staff.findIndex(
      (s) =>
        s.id === staffMemberId &&
        s.companyId === companyId &&
        s.isActive === !target,
    );
    if (index === -1) {
      return Promise.resolve(null);
    }
    const next: StaffMember = {
      ...this.staff[index],
      isActive: target,
      updatedAt: new Date(),
    };
    this.staff[index] = next;
    return Promise.resolve(next);
  }
}
