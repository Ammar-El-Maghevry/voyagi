import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import {
  toMembership,
  toMembershipView,
  toProfile,
  type MembershipRow,
  type MembershipViewRow,
  type ProfileRow,
} from './identity.mapper';
import type { IdentityRepository, PagedResult } from './identity.repository';
import type {
  Membership,
  MembershipView,
  Profile,
  ProfileUpdate,
} from './identity.types';

/** Explicit, non-`SELECT *` column lists (aligned with the mapper row shapes). */
const PROFILE_COLUMNS =
  'id, full_name, phone_number, is_active, created_at, updated_at';

const MEMBERSHIP_COLUMNS =
  'id, user_id, company_id, branch_id, role, is_active, created_at, updated_at';

/**
 * PostgreSQL adapter for the identity domain. Uses only parameterized queries
 * with explicit column lists, always scopes membership reads by `company_id`,
 * and maps rows to typed domain objects. It runs on the backend's trusted
 * connection (which bypasses RLS), so the `company_id` predicates below are the
 * authoritative tenant boundary.
 */
@Injectable()
export class PostgresIdentityRepository implements IdentityRepository {
  private readonly logger = new Logger(PostgresIdentityRepository.name);

  // Injected as the concrete pool-backed service, but typed as the narrow
  // executor so tests can drive the repository inside a transaction.
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseExecutor,
  ) {}

  async findProfileByUserId(userId: string): Promise<Profile | null> {
    const result = await this.database.query<ProfileRow>(
      `SELECT ${PROFILE_COLUMNS} FROM public.profiles WHERE id = $1`,
      [userId],
      { name: 'identity.profile.find_by_user' },
    );
    const row = result.rows[0];
    return row ? toProfile(row) : null;
  }

  async updateProfile(
    userId: string,
    update: ProfileUpdate,
  ): Promise<Profile | null> {
    // Build the SET clause from whitelisted columns only; values are always
    // parameterized. `phoneNumber: null` explicitly clears the number.
    const assignments: string[] = [];
    const params: unknown[] = [userId];

    if (update.fullName !== undefined) {
      params.push(update.fullName);
      assignments.push(`full_name = $${params.length}`);
    }
    if (update.phoneNumber !== undefined) {
      params.push(update.phoneNumber);
      assignments.push(`phone_number = $${params.length}`);
    }

    const result = await this.database.query<ProfileRow>(
      `UPDATE public.profiles SET ${assignments.join(', ')}
         WHERE id = $1
         RETURNING ${PROFILE_COLUMNS}`,
      params,
      { name: 'identity.profile.update' },
    );
    const row = result.rows[0];
    return row ? toProfile(row) : null;
  }

  async findActiveMembershipsForCompany(
    userId: string,
    companyId: string,
  ): Promise<Membership[]> {
    const result = await this.database.query<MembershipRow>(
      `SELECT ${MEMBERSHIP_COLUMNS}
         FROM public.company_memberships
         WHERE user_id = $1 AND company_id = $2 AND is_active = true
         ORDER BY id`,
      [userId, companyId],
      { name: 'identity.membership.find_active_for_company' },
    );
    return this.mapMemberships(result.rows);
  }

  async listMembershipsForUser(
    userId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<MembershipView>> {
    const rows = await this.database.query<MembershipViewRow>(
      `SELECT m.id, m.user_id, m.company_id, m.branch_id, m.role,
              m.is_active, m.created_at, m.updated_at,
              c.name AS company_name, p.full_name AS member_name
         FROM public.company_memberships m
         JOIN public.companies c ON c.id = m.company_id
         JOIN public.profiles p ON p.id = m.user_id
         WHERE m.user_id = $1 AND m.is_active = true
         ORDER BY c.name, m.id
         LIMIT $2 OFFSET $3`,
      [userId, pagination.limit, pagination.offset],
      { name: 'identity.membership.list_for_user' },
    );
    const total = await this.count(
      `SELECT count(*)::text AS total
         FROM public.company_memberships
         WHERE user_id = $1 AND is_active = true`,
      [userId],
      'identity.membership.count_for_user',
    );
    return { items: this.mapViews(rows.rows), total };
  }

  async listCompanyMemberships(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<MembershipView>> {
    const rows = await this.database.query<MembershipViewRow>(
      `SELECT m.id, m.user_id, m.company_id, m.branch_id, m.role,
              m.is_active, m.created_at, m.updated_at,
              c.name AS company_name, p.full_name AS member_name
         FROM public.company_memberships m
         JOIN public.companies c ON c.id = m.company_id
         JOIN public.profiles p ON p.id = m.user_id
         WHERE m.company_id = $1
         ORDER BY m.id
         LIMIT $2 OFFSET $3`,
      [companyId, pagination.limit, pagination.offset],
      { name: 'identity.membership.list_for_company' },
    );
    const total = await this.count(
      `SELECT count(*)::text AS total
         FROM public.company_memberships
         WHERE company_id = $1`,
      [companyId],
      'identity.membership.count_for_company',
    );
    return { items: this.mapViews(rows.rows), total };
  }

  async findCompanyMembership(
    companyId: string,
    membershipId: string,
  ): Promise<MembershipView | null> {
    const result = await this.database.query<MembershipViewRow>(
      `SELECT m.id, m.user_id, m.company_id, m.branch_id, m.role,
              m.is_active, m.created_at, m.updated_at,
              c.name AS company_name, p.full_name AS member_name
         FROM public.company_memberships m
         JOIN public.companies c ON c.id = m.company_id
         JOIN public.profiles p ON p.id = m.user_id
         WHERE m.id = $1 AND m.company_id = $2`,
      [membershipId, companyId],
      { name: 'identity.membership.find_in_company' },
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const view = toMembershipView(row);
    if (view === null) {
      this.warnUnknownRoles(1);
      return null;
    }
    return view;
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

  private mapMemberships(rows: readonly MembershipRow[]): Membership[] {
    const mapped = rows.map((row) => toMembership(row));
    this.warnUnknownRoles(mapped.filter((m) => m === null).length);
    return mapped.filter((m): m is Membership => m !== null);
  }

  private mapViews(rows: readonly MembershipViewRow[]): MembershipView[] {
    const mapped = rows.map((row) => toMembershipView(row));
    this.warnUnknownRoles(mapped.filter((m) => m === null).length);
    return mapped.filter((m): m is MembershipView => m !== null);
  }

  /**
   * Observe rows dropped because their role is not recognized. Logs a count
   * only (never the raw role value or any identifier) so an unexpected enum
   * value surfaces in operations without leaking data.
   */
  private warnUnknownRoles(skipped: number): void {
    if (skipped > 0) {
      this.logger.warn({ event: 'unknown_membership_role_skipped', skipped });
    }
  }
}
