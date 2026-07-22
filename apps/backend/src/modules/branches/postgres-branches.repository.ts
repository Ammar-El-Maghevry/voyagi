import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { DatabaseService } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { BRANCH_COLUMNS, type BranchRow, toBranch } from './branch.mapper';
import type { Branch, BranchCreate, BranchUpdate } from './branch.types';
import type { BranchesRepository, PagedResult } from './branches.repository';

/**
 * PostgreSQL adapter for branches. Every statement is parameterized, selects
 * explicit columns, scopes by `company_id`, and excludes soft-deleted rows
 * (`deleted_at is null`). Running on the backend's trusted (RLS-bypassing)
 * connection, these `company_id` predicates are the authoritative tenant
 * boundary. Driver errors propagate to the shared database exceptions
 * (unique/foreign-key → 409, connection/timeout → 503).
 */
@Injectable()
export class PostgresBranchesRepository implements BranchesRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseExecutor,
  ) {}

  async listByCompany(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Branch>> {
    const rows = await this.database.query<BranchRow>(
      `SELECT ${BRANCH_COLUMNS}
         FROM public.branches
         WHERE company_id = $1 AND deleted_at IS NULL
         ORDER BY id
         LIMIT $2 OFFSET $3`,
      [companyId, pagination.limit, pagination.offset],
      { name: 'branches.list_for_company' },
    );
    const total = await this.count(
      `SELECT count(*)::text AS total
         FROM public.branches
         WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId],
      'branches.count_for_company',
    );
    return { items: rows.rows.map(toBranch), total };
  }

  async listByCompanyAndBranchIds(
    companyId: string,
    branchIds: readonly string[],
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Branch>> {
    if (branchIds.length === 0) {
      return { items: [], total: 0 };
    }
    const ids = [...branchIds];
    const rows = await this.database.query<BranchRow>(
      `SELECT ${BRANCH_COLUMNS}
         FROM public.branches
         WHERE company_id = $1 AND deleted_at IS NULL AND id = ANY($2::bigint[])
         ORDER BY id
         LIMIT $3 OFFSET $4`,
      [companyId, ids, pagination.limit, pagination.offset],
      { name: 'branches.list_for_company_scoped' },
    );
    const total = await this.count(
      `SELECT count(*)::text AS total
         FROM public.branches
         WHERE company_id = $1 AND deleted_at IS NULL AND id = ANY($2::bigint[])`,
      [companyId, ids],
      'branches.count_for_company_scoped',
    );
    return { items: rows.rows.map(toBranch), total };
  }

  async findInCompany(
    companyId: string,
    branchId: string,
  ): Promise<Branch | null> {
    const result = await this.database.query<BranchRow>(
      `SELECT ${BRANCH_COLUMNS}
         FROM public.branches
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [branchId, companyId],
      { name: 'branches.find_in_company' },
    );
    const row = result.rows[0];
    return row ? toBranch(row) : null;
  }

  async create(companyId: string, input: BranchCreate): Promise<Branch> {
    const result = await this.database.query<BranchRow>(
      `INSERT INTO public.branches (company_id, city_id, name_ar, name_fr, phone)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${BRANCH_COLUMNS}`,
      [companyId, input.cityId, input.nameAr, input.nameFr, input.phone ?? null],
      { name: 'branches.insert' },
    );
    return toBranch(result.rows[0]);
  }

  async update(
    companyId: string,
    branchId: string,
    input: BranchUpdate,
  ): Promise<Branch | null> {
    // Build the SET clause from whitelisted columns only; values are always
    // parameterized. `phone: null` explicitly clears the stored number.
    const assignments: string[] = [];
    const params: unknown[] = [branchId, companyId];

    if (input.cityId !== undefined) {
      params.push(input.cityId);
      assignments.push(`city_id = $${params.length}`);
    }
    if (input.nameAr !== undefined) {
      params.push(input.nameAr);
      assignments.push(`name_ar = $${params.length}`);
    }
    if (input.nameFr !== undefined) {
      params.push(input.nameFr);
      assignments.push(`name_fr = $${params.length}`);
    }
    if (input.phone !== undefined) {
      params.push(input.phone);
      assignments.push(`phone = $${params.length}`);
    }

    const result = await this.database.query<BranchRow>(
      `UPDATE public.branches
         SET ${assignments.join(', ')}, updated_at = now()
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
         RETURNING ${BRANCH_COLUMNS}`,
      params,
      { name: 'branches.update' },
    );
    const row = result.rows[0];
    return row ? toBranch(row) : null;
  }

  async transitionActive(
    companyId: string,
    branchId: string,
    target: boolean,
  ): Promise<Branch | null> {
    // The precondition `is_active = NOT target` is part of the WHERE clause, so
    // the read and the write are one atomic statement: a redundant transition
    // updates no row (and returns null) rather than racing a separate read.
    const result = await this.database.query<BranchRow>(
      `UPDATE public.branches
         SET is_active = $3, updated_at = now()
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
           AND is_active = NOT $3
         RETURNING ${BRANCH_COLUMNS}`,
      [branchId, companyId, target],
      { name: 'branches.transition_active' },
    );
    const row = result.rows[0];
    return row ? toBranch(row) : null;
  }

  private async count(
    text: string,
    params: readonly unknown[],
    name: string,
  ): Promise<number> {
    const result = await this.database.query<{ total: string }>(text, params, {
      name,
    });
    return Number(result.rows[0]?.total ?? 0);
  }
}
