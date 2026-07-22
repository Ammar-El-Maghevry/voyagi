import { Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { parseMembershipRole } from '../identity/membership-role';
import type {
  InsertPaymentParams,
  LockedPayment,
  PaymentsRepository,
  TransitionPaymentParams,
} from './payments.repository';
import {
  type PayableBooking,
  type Payment,
  type PaymentAccessScope,
  type PaymentIdempotencyClaim,
  type PaymentMembership,
  PaymentMethod,
  type PaymentPage,
  PaymentStatus,
  PAYABLE_BOOKING_STATUSES,
} from './payment.types';

interface PaymentRow {
  id: string;
  booking_id: string;
  company_id: string;
  method: string;
  status: string;
  amount: string;
  currency: string;
  provider_reference: string | null;
  internal_reference: string;
  confirmed_by_user_id: string | null;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const SETTLED_STATUSES = [
  PaymentStatus.Succeeded,
  PaymentStatus.PartiallyRefunded,
  PaymentStatus.Refunded,
];

const PAYMENT_COLUMNS = `p.id, p.booking_id, b.company_id::text AS company_id,
  p.method::text, p.status::text, p.amount::text, p.currency,
  p.provider_reference, p.internal_reference, p.confirmed_by_user_id,
  p.paid_at, p.created_at, p.updated_at`;

@Injectable()
export class PostgresPaymentsRepository implements PaymentsRepository {
  async findMemberships(
    executor: DatabaseExecutor,
    actorUserId: string,
    companyId: string,
  ): Promise<PaymentMembership[]> {
    const result = await executor.query<{
      id: string;
      user_id: string;
      company_id: string;
      branch_id: string | null;
      role: string;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id::text, user_id, company_id::text, branch_id::text,
              role::text, is_active, created_at, updated_at
         FROM public.company_memberships
        WHERE user_id = $1 AND company_id = $2 AND is_active`,
      [actorUserId, companyId],
      { name: 'payments.find_actor_memberships' },
    );
    return result.rows.flatMap((row) => {
      const role = parseMembershipRole(row.role);
      return role
        ? [
            {
              id: row.id,
              userId: row.user_id,
              companyId: row.company_id,
              branchId: row.branch_id ?? undefined,
              role,
              isActive: row.is_active,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            },
          ]
        : [];
    });
  }

  async findPayableForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<PayableBooking | null> {
    return this.findPayable(
      executor,
      `b.id = $1 AND b.booked_by_user_id = $2
       AND b.booking_channel IN ('WEB', 'MOBILE_APP')`,
      [bookingId, ownerUserId],
    );
  }

  async findPayableForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: PaymentAccessScope,
    bookingId: string,
  ): Promise<PayableBooking | null> {
    return this.findPayable(
      executor,
      `b.id = $1 AND b.company_id = $2
       AND ($3::boolean OR b.branch_id = ANY($4::bigint[]))`,
      [bookingId, companyId, scope.companyWide, scope.branchIds],
    );
  }

  private async findPayable(
    executor: DatabaseExecutor,
    where: string,
    params: readonly unknown[],
  ): Promise<PayableBooking | null> {
    const result = await executor.query<{
      booking_id: string;
      company_id: string;
      branch_id: string | null;
      booked_by_user_id: string | null;
      booking_channel: string;
      status: string;
      total_amount: string;
      currency: string;
      expires_at: Date | null;
    }>(
      `SELECT b.id AS booking_id, b.company_id::text AS company_id,
              b.branch_id::text AS branch_id, b.booked_by_user_id,
              b.booking_channel::text AS booking_channel, b.status::text AS status,
              b.total_amount::text AS total_amount, b.currency, b.expires_at
         FROM public.bookings b
        WHERE ${where}
        FOR UPDATE OF b`,
      params,
      { name: 'payments.find_payable_booking' },
    );
    const row = result.rows[0];
    return row
      ? {
          bookingId: row.booking_id,
          companyId: row.company_id,
          branchId: row.branch_id ?? undefined,
          bookedByUserId: row.booked_by_user_id ?? undefined,
          bookingChannel: row.booking_channel,
          status: row.status,
          totalAmount: row.total_amount,
          currency: row.currency,
          expiresAt: row.expires_at ?? undefined,
        }
      : null;
  }

  async claimIdempotency(
    executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    key: string,
    fingerprint: string,
  ): Promise<PaymentIdempotencyClaim> {
    const inserted = await executor.query<{ id: string }>(
      `INSERT INTO public.idempotency_records
         (company_id, actor_user_id, operation, idempotency_key, request_fingerprint)
       VALUES ($1, $2, 'CREATE_PAYMENT', $3, $4)
       ON CONFLICT (company_id, actor_user_id, operation, idempotency_key)
       DO UPDATE SET
         request_fingerprint = EXCLUDED.request_fingerprint,
         booking_id = NULL,
         payment_id = NULL,
         response_status = NULL,
         completed_at = NULL,
         expires_at = now() + interval '24 hours',
         created_at = now()
       WHERE idempotency_records.expires_at <= now()
       RETURNING id::text`,
      [companyId, actorUserId, key, fingerprint],
      { name: 'payments.claim_idempotency' },
    );
    if (inserted.rows[0]) {
      return { kind: 'claimed' };
    }

    const existing = await executor.query<{
      request_fingerprint: string;
      payment_id: string | null;
    }>(
      `SELECT request_fingerprint, payment_id
         FROM public.idempotency_records
        WHERE company_id = $1 AND actor_user_id = $2
          AND operation = 'CREATE_PAYMENT' AND idempotency_key = $3
        FOR UPDATE`,
      [companyId, actorUserId, key],
      { name: 'payments.lock_idempotency' },
    );
    const row = existing.rows[0];
    if (!row || row.request_fingerprint !== fingerprint) {
      return { kind: 'conflict' };
    }
    return row.payment_id
      ? { kind: 'replay', paymentId: row.payment_id }
      : { kind: 'conflict' };
  }

  async completeIdempotency(
    executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    key: string,
    bookingId: string,
    paymentId: string,
  ): Promise<void> {
    await executor.query(
      `UPDATE public.idempotency_records
          SET booking_id = $4, payment_id = $5, response_status = 201, completed_at = now()
        WHERE company_id = $1 AND actor_user_id = $2
          AND operation = 'CREATE_PAYMENT' AND idempotency_key = $3
          AND payment_id IS NULL`,
      [companyId, actorUserId, key, bookingId, paymentId],
      { name: 'payments.complete_idempotency' },
    );
  }

  async insertPayment(
    executor: DatabaseExecutor,
    params: InsertPaymentParams,
  ): Promise<string | null> {
    const result = await executor.query<{ id: string }>(
      `INSERT INTO public.payments
         (booking_id, method, status, amount, currency, internal_reference)
       SELECT b.id, $2::public.payment_method_enum, 'PENDING',
              b.total_amount, b.currency, $3
         FROM public.bookings b
        WHERE b.id = $1
          AND b.status = ANY($4::public.booking_status_enum[])
          AND (b.expires_at IS NULL OR b.expires_at > now())
          AND NOT EXISTS (
            SELECT 1 FROM public.payments p
             WHERE p.booking_id = b.id
               AND p.status = ANY($5::public.payment_status_enum[])
          )
       ON CONFLICT (internal_reference) DO NOTHING
       RETURNING id`,
      [
        params.bookingId,
        params.method,
        params.internalReference,
        PAYABLE_BOOKING_STATUSES,
        SETTLED_STATUSES,
      ],
      { name: 'payments.insert' },
    );
    return result.rows[0]?.id ?? null;
  }

  async findPaymentForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    paymentId: string,
  ): Promise<Payment | null> {
    return this.findOne(
      executor,
      `p.id = $1 AND b.booked_by_user_id = $2
       AND b.booking_channel IN ('WEB', 'MOBILE_APP')`,
      [paymentId, ownerUserId],
    );
  }

  async findPaymentForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: PaymentAccessScope,
    paymentId: string,
  ): Promise<Payment | null> {
    return this.findOne(
      executor,
      `p.id = $1 AND b.company_id = $2
       AND ($3::boolean OR b.branch_id = ANY($4::bigint[]))`,
      [paymentId, companyId, scope.companyWide, scope.branchIds],
    );
  }

  async listPaymentsForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    pagination: ResolvedPagination,
  ): Promise<PaymentPage> {
    return this.list(
      executor,
      `b.booked_by_user_id = $1 AND b.booking_channel IN ('WEB', 'MOBILE_APP')`,
      [ownerUserId],
      pagination,
    );
  }

  async listPaymentsForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: PaymentAccessScope,
    pagination: ResolvedPagination,
  ): Promise<PaymentPage> {
    return this.list(
      executor,
      `b.company_id = $1 AND ($2::boolean OR b.branch_id = ANY($3::bigint[]))`,
      [companyId, scope.companyWide, scope.branchIds],
      pagination,
    );
  }

  async lockPaymentForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: PaymentAccessScope,
    paymentId: string,
  ): Promise<LockedPayment | null> {
    return this.lock(
      executor,
      `p.id = $1 AND b.company_id = $2
       AND ($3::boolean OR b.branch_id = ANY($4::bigint[]))`,
      [paymentId, companyId, scope.companyWide, scope.branchIds],
    );
  }

  async lockPaymentByInternalReference(
    executor: DatabaseExecutor,
    internalReference: string,
  ): Promise<LockedPayment | null> {
    return this.lock(executor, `p.internal_reference = $1`, [internalReference]);
  }

  private async lock(
    executor: DatabaseExecutor,
    where: string,
    params: readonly unknown[],
  ): Promise<LockedPayment | null> {
    const result = await executor.query<{
      id: string;
      booking_id: string;
      company_id: string;
      branch_id: string | null;
      booked_by_user_id: string | null;
      booking_channel: string;
      method: string;
      status: string;
      amount: string;
      currency: string;
      provider_reference: string | null;
      internal_reference: string;
    }>(
      `SELECT p.id, p.booking_id, b.company_id::text AS company_id,
              b.branch_id::text AS branch_id, b.booked_by_user_id,
              b.booking_channel::text AS booking_channel, p.method::text AS method,
              p.status::text AS status, p.amount::text AS amount, p.currency,
              p.provider_reference, p.internal_reference
         FROM public.payments p
         JOIN public.bookings b ON b.id = p.booking_id
        WHERE ${where}
        FOR UPDATE OF p, b`,
      params,
      { name: 'payments.lock' },
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          bookingId: row.booking_id,
          companyId: row.company_id,
          branchId: row.branch_id ?? undefined,
          bookedByUserId: row.booked_by_user_id ?? undefined,
          bookingChannel: row.booking_channel,
          method: this.method(row.method),
          status: this.status(row.status),
          amount: row.amount,
          currency: row.currency,
          providerReference: row.provider_reference ?? undefined,
          internalReference: row.internal_reference,
        }
      : null;
  }

  async transitionPayment(
    executor: DatabaseExecutor,
    params: TransitionPaymentParams,
  ): Promise<Payment | null> {
    const result = await executor.query<PaymentRow>(
      `WITH updated AS (
         UPDATE public.payments p
            SET status = $3::public.payment_status_enum,
                provider_reference = COALESCE($4, p.provider_reference),
                confirmed_by_user_id = COALESCE($5, p.confirmed_by_user_id),
                paid_at = CASE WHEN $6::boolean THEN now() ELSE p.paid_at END,
                updated_at = now()
          WHERE p.id = $1 AND p.status = $2::public.payment_status_enum
          RETURNING p.id, p.booking_id, p.method, p.status, p.amount, p.currency,
                    p.provider_reference, p.internal_reference,
                    p.confirmed_by_user_id, p.paid_at, p.created_at, p.updated_at
       )
       SELECT updated.id, updated.booking_id, b.company_id::text AS company_id,
              updated.method::text, updated.status::text, updated.amount::text,
              updated.currency, updated.provider_reference, updated.internal_reference,
              updated.confirmed_by_user_id, updated.paid_at,
              updated.created_at, updated.updated_at
         FROM updated
         JOIN public.bookings b ON b.id = updated.booking_id`,
      [
        params.paymentId,
        params.from,
        params.to,
        params.providerReference ?? null,
        params.confirmedByUserId ?? null,
        params.setPaidAt ?? false,
      ],
      { name: 'payments.transition' },
    );
    const row = result.rows[0];
    return row ? this.mapPayment(row) : null;
  }

  async confirmBookingPaid(
    executor: DatabaseExecutor,
    bookingId: string,
  ): Promise<boolean> {
    const result = await executor.query<{ id: string }>(
      `WITH confirmed AS (
         UPDATE public.bookings
            SET status = 'CONFIRMED', version = version + 1, updated_at = now()
          WHERE id = $1 AND status IN ('HELD', 'PENDING_PAYMENT')
          RETURNING id
       ), seats AS (
         UPDATE public.seat_reservations seat
            SET status = 'CONFIRMED', updated_at = now()
           FROM confirmed
          WHERE seat.booking_id = confirmed.id AND seat.status = 'HELD'
          RETURNING seat.id
       )
       SELECT id FROM confirmed`,
      [bookingId],
      { name: 'payments.confirm_booking' },
    );
    return Boolean(result.rows[0]);
  }

  async appendBookingEvent(
    executor: DatabaseExecutor,
    bookingId: string,
    companyId: string,
    actorUserId: string | null,
    eventType: string,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO public.booking_events
         (booking_id, company_id, actor_user_id, event_type)
       VALUES ($1, $2, $3, $4::public.booking_event_type_enum)`,
      [bookingId, companyId, actorUserId, eventType],
      { name: 'payments.append_booking_event' },
    );
  }

  private async findOne(
    executor: DatabaseExecutor,
    where: string,
    params: readonly unknown[],
  ): Promise<Payment | null> {
    const result = await executor.query<PaymentRow>(
      `SELECT ${PAYMENT_COLUMNS}
         FROM public.payments p
         JOIN public.bookings b ON b.id = p.booking_id
        WHERE ${where}`,
      params,
      { name: 'payments.find_scoped' },
    );
    const row = result.rows[0];
    return row ? this.mapPayment(row) : null;
  }

  private async list(
    executor: DatabaseExecutor,
    where: string,
    params: readonly unknown[],
    pagination: ResolvedPagination,
  ): Promise<PaymentPage> {
    const pageParams = [...params, pagination.limit, pagination.offset];
    const result = await executor.query<PaymentRow>(
      `SELECT ${PAYMENT_COLUMNS}
         FROM public.payments p
         JOIN public.bookings b ON b.id = p.booking_id
        WHERE ${where}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      pageParams,
      { name: 'payments.list_scoped' },
    );
    const count = await executor.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM public.payments p
         JOIN public.bookings b ON b.id = p.booking_id
        WHERE ${where}`,
      params,
      { name: 'payments.count_scoped' },
    );
    return {
      items: result.rows.map((row) => this.mapPayment(row)),
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  private mapPayment(row: PaymentRow): Payment {
    return {
      id: row.id,
      bookingId: row.booking_id,
      companyId: row.company_id,
      method: this.method(row.method),
      status: this.status(row.status),
      amount: row.amount,
      currency: row.currency,
      providerReference: row.provider_reference ?? undefined,
      internalReference: row.internal_reference,
      confirmedByUserId: row.confirmed_by_user_id ?? undefined,
      paidAt: row.paid_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private method(value: string): PaymentMethod {
    if ((Object.values(PaymentMethod) as string[]).includes(value)) {
      return value as PaymentMethod;
    }
    throw new Error('database returned an unknown payment method');
  }

  private status(value: string): PaymentStatus {
    if ((Object.values(PaymentStatus) as string[]).includes(value)) {
      return value as PaymentStatus;
    }
    throw new Error('database returned an unknown payment status');
  }
}
