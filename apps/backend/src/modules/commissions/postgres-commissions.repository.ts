import { Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { parseMembershipRole } from '../identity/membership-role';
import { mapCommission, type CommissionRow } from './commission.mapper';
import type { CommissionsRepository } from './commissions.repository';
import type {
  CommissionAccessScope,
  CommissionMembership,
  CommissionPage,
  CommissionTransaction,
} from './commission.types';

const COMMISSION_COLUMNS = `c.id, c.agent_membership_id::text, c.booking_id,
  c.company_id::text, c.commission_rate::text, c.base_amount::text,
  c.commission_amount::text, c.currency, c.status::text, c.earned_at, c.paid_at,
  c.cancelled_at, c.created_at, c.updated_at`;

@Injectable()
export class PostgresCommissionsRepository implements CommissionsRepository {
  async findActorMemberships(
    executor: DatabaseExecutor,
    actorUserId: string,
    companyId: string,
  ): Promise<CommissionMembership[]> {
    const result = await executor.query<{ id: string; role: string }>(
      `SELECT id::text, role::text
         FROM public.company_memberships
        WHERE user_id = $1 AND company_id = $2 AND is_active`,
      [actorUserId, companyId],
      { name: 'commissions.find_actor_memberships' },
    );
    return result.rows.flatMap((row) => {
      const role = parseMembershipRole(row.role);
      return role ? [{ id: row.id, role }] : [];
    });
  }

  async listForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: CommissionAccessScope,
    pagination: ResolvedPagination,
  ): Promise<CommissionPage> {
    const params = [companyId, scope.companyWide, scope.agentMembershipIds];
    const where = `c.company_id = $1
      AND ($2::boolean OR c.agent_membership_id = ANY($3::bigint[]))`;
    const rows = await executor.query<CommissionRow>(
      `SELECT ${COMMISSION_COLUMNS}
         FROM public.agent_commission_transactions c
        WHERE ${where}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT $4 OFFSET $5`,
      [...params, pagination.limit, pagination.offset],
      { name: 'commissions.list_scoped' },
    );
    const count = await executor.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM public.agent_commission_transactions c
        WHERE ${where}`,
      params,
      { name: 'commissions.count_scoped' },
    );
    return {
      items: rows.rows.map(mapCommission),
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  async createEligible(
    executor: DatabaseExecutor,
    bookingId: string,
    companyId: string,
  ): Promise<CommissionTransaction | null> {
    const inserted = await executor.query<CommissionRow>(
      `INSERT INTO public.agent_commission_transactions
         (agent_membership_id, booking_id, company_id, commission_rate, base_amount,
          commission_amount, currency, status, earned_at)
       SELECT membership.id, booking.id, booking.company_id, membership.commission_rate,
              booking.total_amount,
              round(booking.total_amount * membership.commission_rate / 100, 2),
              booking.currency, 'EARNED', now()
         FROM public.bookings booking
         JOIN public.company_memberships membership
           ON membership.company_id = booking.company_id
          AND membership.user_id = booking.booked_by_user_id
          AND membership.role = 'AGENT'
          AND membership.is_active
        WHERE booking.id = $1
          AND booking.company_id = $2
          AND booking.status = 'CONFIRMED'
       ON CONFLICT (agent_membership_id, booking_id) DO NOTHING
       RETURNING id, agent_membership_id::text, booking_id, company_id::text,
                 commission_rate::text, base_amount::text, commission_amount::text,
                 currency, status::text, earned_at, paid_at, cancelled_at, created_at, updated_at`,
      [bookingId, companyId],
      { name: 'commissions.create_eligible' },
    );
    if (inserted.rows[0]) return mapCommission(inserted.rows[0]);

    // The unique key makes retries return the immutable original transaction.
    const existing = await executor.query<CommissionRow>(
      `SELECT ${COMMISSION_COLUMNS}
         FROM public.agent_commission_transactions c
         JOIN public.bookings booking
           ON booking.id = c.booking_id AND booking.company_id = c.company_id
         JOIN public.company_memberships membership
           ON membership.id = c.agent_membership_id
          AND membership.company_id = c.company_id
          AND membership.user_id = booking.booked_by_user_id
        WHERE c.booking_id = $1 AND c.company_id = $2
          AND membership.role = 'AGENT'`,
      [bookingId, companyId],
      { name: 'commissions.find_existing_eligible' },
    );
    return existing.rows[0] ? mapCommission(existing.rows[0]) : null;
  }

  async applyBookingCancellation(
    executor: DatabaseExecutor,
    bookingId: string,
    companyId: string,
  ): Promise<CommissionTransaction | null> {
    return this.cancel(executor, bookingId, companyId, '');
  }

  async applyFullRefund(
    executor: DatabaseExecutor,
    bookingId: string,
    companyId: string,
  ): Promise<CommissionTransaction | null> {
    return this.cancel(
      executor,
      bookingId,
      companyId,
      `AND EXISTS (
         SELECT 1 FROM public.bookings booking
          WHERE booking.id = c.booking_id AND booking.company_id = c.company_id
            AND booking.status IN ('CANCELLED', 'PARTIALLY_CANCELLED')
       )
       AND EXISTS (
         SELECT 1 FROM public.payments payment
          WHERE payment.booking_id = c.booking_id AND payment.status = 'REFUNDED'
       )`,
    );
  }

  private async cancel(
    executor: DatabaseExecutor,
    bookingId: string,
    companyId: string,
    additionalWhere: string,
  ): Promise<CommissionTransaction | null> {
    const result = await executor.query<CommissionRow>(
      `WITH changed AS (
         UPDATE public.agent_commission_transactions c
            SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
          WHERE c.booking_id = $1 AND c.company_id = $2
            AND c.status IN ('PENDING', 'EARNED')
            ${additionalWhere}
          RETURNING c.id, c.agent_membership_id::text, c.booking_id, c.company_id::text,
                    c.commission_rate::text, c.base_amount::text, c.commission_amount::text,
                    c.currency, c.status::text, c.earned_at, c.paid_at, c.cancelled_at,
                    c.created_at, c.updated_at
       )
       SELECT * FROM changed
       UNION ALL
       SELECT ${COMMISSION_COLUMNS}
         FROM public.agent_commission_transactions c
        WHERE c.booking_id = $1 AND c.company_id = $2 AND c.status = 'PAID'
          ${additionalWhere}
          AND NOT EXISTS (SELECT 1 FROM changed)`,
      [bookingId, companyId],
      { name: 'commissions.cancel_eligible' },
    );
    return result.rows[0] ? mapCommission(result.rows[0]) : null;
  }
}
