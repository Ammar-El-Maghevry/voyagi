import type { ResolvedPagination } from '../../common/pagination/pagination';
import type {
  StaffMember,
  StaffMemberCreate,
  StaffMemberUpdate,
} from './staff.types';

/** A single page of rows plus the unbounded total, for building pagination meta. */
export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** DI token bound to the concrete {@link StaffRepository} implementation. */
export const STAFF_REPOSITORY = Symbol('STAFF_REPOSITORY');

/**
 * Persistence port for staff members.
 *
 * Staff are company-scoped (no branch column). Every method takes `companyId`
 * explicitly and scopes its SQL by it, so a staff id alone is never sufficient
 * to read or mutate a record; soft-deleted rows are excluded everywhere. Driver
 * errors propagate as the shared database exceptions.
 */
export interface StaffRepository {
  /** A page of the company's staff members (active or not, excluding soft-deleted). */
  listByCompany(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<StaffMember>>;

  /** A single staff member addressed within one company, or `null` if not there. */
  findInCompany(
    companyId: string,
    staffMemberId: string,
  ): Promise<StaffMember | null>;

  /** Insert a staff member for the company. */
  create(companyId: string, input: StaffMemberCreate): Promise<StaffMember>;

  /**
   * Update a staff member's fields within the company. Returns the new state, or
   * `null` when no matching (non-deleted) staff member exists.
   */
  update(
    companyId: string,
    staffMemberId: string,
    input: StaffMemberUpdate,
  ): Promise<StaffMember | null>;

  /**
   * Atomically flip `is_active` to `target` only when the record currently holds
   * the opposite value. Returns the updated record, or `null` when no row
   * transitioned (missing, or already in the target state).
   */
  transitionActive(
    companyId: string,
    staffMemberId: string,
    target: boolean,
  ): Promise<StaffMember | null>;
}
