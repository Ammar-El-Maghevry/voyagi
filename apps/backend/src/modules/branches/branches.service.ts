import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { ValidationException } from '../../common/validation/validation.exception';
import { parsePositiveBigInt } from '../identity/identifier.util';
import { IdentityService } from '../identity/identity.service';
import { canReadBranch, readableBranchScope } from './branch-access.policy';
import { BranchNotFoundError, BranchStateConflictError } from './branch.errors';
import type { Branch, BranchCreate, BranchUpdate } from './branch.types';
import {
  BRANCHES_REPOSITORY,
  type BranchesRepository,
  type PagedResult,
} from './branches.repository';

const EMPTY_PAGE: PagedResult<Branch> = { items: [], total: 0 };

/**
 * Application service for branches.
 *
 * Read operations are **branch-scoped**: the visible branches are derived from
 * the caller's per-membership entitlements (mirroring the RLS
 * `branches_tenant_read` = `has_branch_access` model), so a branch-restricted
 * member sees only their branch while a company-wide member sees all. Write
 * operations require the company-wide `branches.manage` permission (enforced by
 * the guard) and are scoped to the tenant company in SQL. The caller's auth user
 * id always comes from the verified principal; ids are validated before any
 * query so a malformed value fails closed (`404`) rather than reaching the
 * database as a `22P02` → `500`.
 */
@Injectable()
export class BranchesService {
  constructor(
    @Inject(BRANCHES_REPOSITORY)
    private readonly repository: BranchesRepository,
    private readonly identity: IdentityService,
  ) {}

  /** A page of the branches the caller may read within the company. */
  async listBranches(
    userId: string,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Branch>> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    if (normalizedCompanyId === null) {
      return EMPTY_PAGE;
    }
    const context = await this.identity.resolveMembershipContext(
      userId,
      normalizedCompanyId,
    );
    if (!context) {
      return EMPTY_PAGE;
    }

    const scope = readableBranchScope(context.entitlements);
    switch (scope.kind) {
      case 'all':
        return this.repository.listByCompany(normalizedCompanyId, pagination);
      case 'restricted':
        return this.repository.listByCompanyAndBranchIds(
          normalizedCompanyId,
          scope.branchIds,
          pagination,
        );
      case 'none':
        return EMPTY_PAGE;
    }
  }

  /** A single branch the caller may read, or {@link BranchNotFoundError}. */
  async getBranch(
    userId: string,
    companyId: string,
    branchId: string,
  ): Promise<Branch> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    const normalizedBranchId = parsePositiveBigInt(branchId);
    if (normalizedCompanyId === null || normalizedBranchId === null) {
      throw new BranchNotFoundError();
    }

    const context = await this.identity.resolveMembershipContext(
      userId,
      normalizedCompanyId,
    );
    // No context, or no branch access to this specific branch → not visible.
    if (!context || !canReadBranch(context.entitlements, normalizedBranchId)) {
      throw new BranchNotFoundError();
    }

    const branch = await this.repository.findInCompany(
      normalizedCompanyId,
      normalizedBranchId,
    );
    if (!branch) {
      throw new BranchNotFoundError();
    }
    return branch;
  }

  /** Create a branch for the company (requires `branches.manage`, enforced upstream). */
  async createBranch(companyId: string, input: BranchCreate): Promise<Branch> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    if (normalizedCompanyId === null) {
      // A verified, guard-resolved tenant is always a valid bigint; guard closed.
      throw new BranchNotFoundError();
    }
    return this.repository.create(normalizedCompanyId, input);
  }

  /** Update a branch's descriptive fields within the company. */
  async updateBranch(
    companyId: string,
    branchId: string,
    input: BranchUpdate,
  ): Promise<Branch> {
    if (
      input.cityId === undefined &&
      input.nameAr === undefined &&
      input.nameFr === undefined &&
      input.phone === undefined
    ) {
      throw new ValidationException({
        body: ['At least one updatable field must be provided.'],
      });
    }
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    const normalizedBranchId = parsePositiveBigInt(branchId);
    if (normalizedCompanyId === null || normalizedBranchId === null) {
      throw new BranchNotFoundError();
    }
    const branch = await this.repository.update(
      normalizedCompanyId,
      normalizedBranchId,
      input,
    );
    if (!branch) {
      throw new BranchNotFoundError();
    }
    return branch;
  }

  /**
   * Activate or deactivate a branch. The transition precondition (must currently
   * hold the opposite state) is enforced atomically in the repository; a no-op
   * transition is reported as a conflict, a missing branch as not-found.
   */
  async setBranchActive(
    companyId: string,
    branchId: string,
    target: boolean,
  ): Promise<Branch> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    const normalizedBranchId = parsePositiveBigInt(branchId);
    if (normalizedCompanyId === null || normalizedBranchId === null) {
      throw new BranchNotFoundError();
    }
    const transitioned = await this.repository.transitionActive(
      normalizedCompanyId,
      normalizedBranchId,
      target,
    );
    if (transitioned) {
      return transitioned;
    }
    // No row changed: distinguish "already in target state" from "not here".
    const existing = await this.repository.findInCompany(
      normalizedCompanyId,
      normalizedBranchId,
    );
    if (existing) {
      throw new BranchStateConflictError(target);
    }
    throw new BranchNotFoundError();
  }
}
