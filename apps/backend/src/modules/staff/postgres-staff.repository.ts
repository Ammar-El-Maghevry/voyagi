import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { DatabaseService } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import {
  STAFF_COLUMNS,
  type StaffMemberRow,
  toStaffMember,
} from './staff.mapper';
import type { PagedResult, StaffRepository } from './staff.repository';
import type {
  StaffMember,
  StaffMemberCreate,
  StaffMemberUpdate,
} from './staff.types';

/**
 * PostgreSQL adapter for staff members. Every statement is parameterized,
 * selects explicit columns, scopes by `company_id`, and excludes soft-deleted
 * rows. On the backend's trusted (RLS-bypassing) connection, the `company_id`
 * predicates are the authoritative tenant boundary.
 */
@Injectable()
export class PostgresStaffRepository implements StaffRepository {
  private readonly logger = new Logger(PostgresStaffRepository.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseExecutor,
  ) {}

  async listByCompany(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<StaffMember>> {
    const rows = await this.database.query<StaffMemberRow>(
      `SELECT ${STAFF_COLUMNS}
         FROM public.staff_members
         WHERE company_id = $1 AND deleted_at IS NULL
         ORDER BY id
         LIMIT $2 OFFSET $3`,
      [companyId, pagination.limit, pagination.offset],
      { name: 'staff.list_for_company' },
    );
    const total = await this.count(
      `SELECT count(*)::text AS total
         FROM public.staff_members
         WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId],
      'staff.count_for_company',
    );
    return { items: this.mapRows(rows.rows), total };
  }

  async findInCompany(
    companyId: string,
    staffMemberId: string,
  ): Promise<StaffMember | null> {
    const result = await this.database.query<StaffMemberRow>(
      `SELECT ${STAFF_COLUMNS}
         FROM public.staff_members
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [staffMemberId, companyId],
      { name: 'staff.find_in_company' },
    );
    return this.mapOne(result.rows[0]);
  }

  async create(
    companyId: string,
    input: StaffMemberCreate,
  ): Promise<StaffMember> {
    const result = await this.database.query<StaffMemberRow>(
      `INSERT INTO public.staff_members (company_id, full_name, phone, staff_type)
         VALUES ($1, $2, $3, $4)
         RETURNING ${STAFF_COLUMNS}`,
      [companyId, input.fullName, input.phone ?? null, input.staffType],
      { name: 'staff.insert' },
    );
    const mapped = this.mapOne(result.rows[0]);
    // The value was just inserted from a known enum, so this never fails; guard
    // defensively so an impossible unknown type surfaces as a dependency error
    // rather than a null the caller must interpret.
    if (!mapped) {
      throw new Error('staff_members insert returned an unrecognized staff_type');
    }
    return mapped;
  }

  async update(
    companyId: string,
    staffMemberId: string,
    input: StaffMemberUpdate,
  ): Promise<StaffMember | null> {
    const assignments: string[] = [];
    const params: unknown[] = [staffMemberId, companyId];

    if (input.fullName !== undefined) {
      params.push(input.fullName);
      assignments.push(`full_name = $${params.length}`);
    }
    if (input.staffType !== undefined) {
      params.push(input.staffType);
      assignments.push(`staff_type = $${params.length}`);
    }
    if (input.phone !== undefined) {
      params.push(input.phone);
      assignments.push(`phone = $${params.length}`);
    }

    const result = await this.database.query<StaffMemberRow>(
      `UPDATE public.staff_members
         SET ${assignments.join(', ')}, updated_at = now()
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
         RETURNING ${STAFF_COLUMNS}`,
      params,
      { name: 'staff.update' },
    );
    return this.mapOne(result.rows[0]);
  }

  async transitionActive(
    companyId: string,
    staffMemberId: string,
    target: boolean,
  ): Promise<StaffMember | null> {
    const result = await this.database.query<StaffMemberRow>(
      `UPDATE public.staff_members
         SET is_active = $3, updated_at = now()
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
           AND is_active = NOT $3
         RETURNING ${STAFF_COLUMNS}`,
      [staffMemberId, companyId, target],
      { name: 'staff.transition_active' },
    );
    return this.mapOne(result.rows[0]);
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

  private mapRows(rows: readonly StaffMemberRow[]): StaffMember[] {
    const mapped = rows.map((row) => toStaffMember(row));
    this.warnUnknownTypes(mapped.filter((m) => m === null).length);
    return mapped.filter((m): m is StaffMember => m !== null);
  }

  private mapOne(row: StaffMemberRow | undefined): StaffMember | null {
    if (!row) {
      return null;
    }
    const mapped = toStaffMember(row);
    if (mapped === null) {
      this.warnUnknownTypes(1);
      return null;
    }
    return mapped;
  }

  /** Count-only observation of rows dropped for an unrecognized staff_type. */
  private warnUnknownTypes(skipped: number): void {
    if (skipped > 0) {
      this.logger.warn({ event: 'unknown_staff_type_skipped', skipped });
    }
  }
}
