import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { Branch, BranchCreate, BranchUpdate } from './branch.types';

/** A single page of rows plus the unbounded total, for building pagination meta. */
export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** DI token bound to the concrete {@link BranchesRepository} implementation. */
export const BRANCHES_REPOSITORY = Symbol('BRANCHES_REPOSITORY');

/**
 * Persistence port for branches.
 *
 * Every method takes `companyId` explicitly and scopes its SQL by it, so the
 * backend's trusted (RLS-bypassing) connection cannot cross company boundaries:
 * a branch id alone is never sufficient to read or mutate a branch. Soft-deleted
 * rows (`deleted_at is not null`) are excluded everywhere. Implementations map
 * rows to typed domain objects and let driver errors propagate as the shared
 * database exceptions (unique/foreign-key → 409, connection/timeout → 503).
 */
export interface BranchesRepository {
  /** A page of the company's branches (active or not, excluding soft-deleted). */
  listByCompany(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Branch>>;

  /**
   * A page of the company's branches restricted to a specific set of branch ids
   * (the caller's readable scope). An empty id set yields an empty page.
   */
  listByCompanyAndBranchIds(
    companyId: string,
    branchIds: readonly string[],
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Branch>>;

  /** A single branch addressed within one company, or `null` if not there. */
  findInCompany(companyId: string, branchId: string): Promise<Branch | null>;

  /** Insert a branch for the company. */
  create(companyId: string, input: BranchCreate): Promise<Branch>;

  /**
   * Update a branch's descriptive fields within the company. Returns the new
   * state, or `null` when no matching (non-deleted) branch exists.
   */
  update(
    companyId: string,
    branchId: string,
    input: BranchUpdate,
  ): Promise<Branch | null>;

  /**
   * Atomically flip `is_active` to `target` only when the branch currently holds
   * the opposite value (the transition precondition is in the SQL, not a
   * read-then-write). Returns the updated branch, or `null` when no row
   * transitioned — either the branch does not exist here or it is already in the
   * target state; the caller disambiguates via {@link findInCompany}.
   */
  transitionActive(
    companyId: string,
    branchId: string,
    target: boolean,
  ): Promise<Branch | null>;
}
