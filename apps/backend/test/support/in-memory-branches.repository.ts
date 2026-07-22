import type { ResolvedPagination } from '../../src/common/pagination/pagination';
import { UniqueConstraintViolationError } from '../../src/infrastructure/database/database.errors';
import type {
  BranchesRepository,
  PagedResult,
} from '../../src/modules/branches/branches.repository';
import type {
  Branch,
  BranchCreate,
  BranchUpdate,
} from '../../src/modules/branches/branch.types';

interface SeedBranch {
  id: string;
  companyId: string;
  cityId: string;
  nameAr: string;
  nameFr: string;
  phone?: string;
  isActive?: boolean;
}

/**
 * In-memory {@link BranchesRepository} for e2e tests. Preserves the SQL adapter's
 * observable semantics — company scoping, soft-delete exclusion, the composite
 * unique constraint on (company, name_ar, name_fr), and atomic activation
 * transitions — without a real database.
 */
export class InMemoryBranchesRepository implements BranchesRepository {
  private readonly branches: Branch[] = [];
  private sequence = 1000;
  private failWith: Error | null = null;

  addBranch(seed: SeedBranch): void {
    const now = new Date('2026-01-01T00:00:00.000Z');
    this.branches.push({
      id: seed.id,
      companyId: seed.companyId,
      cityId: seed.cityId,
      nameAr: seed.nameAr,
      nameFr: seed.nameFr,
      phone: seed.phone,
      isActive: seed.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Make the next repository call reject, to exercise the dependency-error path. */
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
  ): Promise<PagedResult<Branch>> {
    this.maybeFail();
    const all = this.branches.filter((b) => b.companyId === companyId);
    return Promise.resolve(this.paginate(all, pagination));
  }

  listByCompanyAndBranchIds(
    companyId: string,
    branchIds: readonly string[],
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Branch>> {
    this.maybeFail();
    if (branchIds.length === 0) {
      return Promise.resolve({ items: [], total: 0 });
    }
    const set = new Set(branchIds);
    const all = this.branches.filter(
      (b) => b.companyId === companyId && set.has(b.id),
    );
    return Promise.resolve(this.paginate(all, pagination));
  }

  findInCompany(companyId: string, branchId: string): Promise<Branch | null> {
    this.maybeFail();
    return Promise.resolve(
      this.branches.find(
        (b) => b.id === branchId && b.companyId === companyId,
      ) ?? null,
    );
  }

  create(companyId: string, input: BranchCreate): Promise<Branch> {
    this.maybeFail();
    if (
      this.branches.some(
        (b) =>
          b.companyId === companyId &&
          b.nameAr === input.nameAr &&
          b.nameFr === input.nameFr,
      )
    ) {
      return Promise.reject(new UniqueConstraintViolationError());
    }
    const now = new Date();
    const branch: Branch = {
      id: String(++this.sequence),
      companyId,
      cityId: input.cityId,
      nameAr: input.nameAr,
      nameFr: input.nameFr,
      phone: input.phone,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    this.branches.push(branch);
    return Promise.resolve(branch);
  }

  update(
    companyId: string,
    branchId: string,
    input: BranchUpdate,
  ): Promise<Branch | null> {
    this.maybeFail();
    const index = this.branches.findIndex(
      (b) => b.id === branchId && b.companyId === companyId,
    );
    if (index === -1) {
      return Promise.resolve(null);
    }
    const current = this.branches[index];
    const next: Branch = {
      ...current,
      cityId: input.cityId ?? current.cityId,
      nameAr: input.nameAr ?? current.nameAr,
      nameFr: input.nameFr ?? current.nameFr,
      phone:
        input.phone === undefined
          ? current.phone
          : (input.phone ?? undefined),
      updatedAt: new Date(),
    };
    this.branches[index] = next;
    return Promise.resolve(next);
  }

  transitionActive(
    companyId: string,
    branchId: string,
    target: boolean,
  ): Promise<Branch | null> {
    this.maybeFail();
    const index = this.branches.findIndex(
      (b) =>
        b.id === branchId &&
        b.companyId === companyId &&
        b.isActive === !target,
    );
    if (index === -1) {
      return Promise.resolve(null);
    }
    const next: Branch = {
      ...this.branches[index],
      isActive: target,
      updatedAt: new Date(),
    };
    this.branches[index] = next;
    return Promise.resolve(next);
  }

  private paginate(
    rows: Branch[],
    pagination: ResolvedPagination,
  ): PagedResult<Branch> {
    const page = rows.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );
    return { items: page, total: rows.length };
  }
}
