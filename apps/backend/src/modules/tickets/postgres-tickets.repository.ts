import { Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { parseMembershipRole } from '../identity/membership-role';
import type {
  InsertTicketParams,
  LockedTicket,
  TicketableBooking,
  TicketsRepository,
} from './tickets.repository';
import {
  deriveTicketStatus,
  type IssuablePassenger,
  type Ticket,
  type TicketAccessScope,
  type TicketMembership,
  type TicketPage,
  type VerifiableTicket,
} from './ticket.types';

interface TicketRow {
  id: string;
  booking_id: string;
  company_id: string;
  passenger_id: string;
  seat_reservation_id: string;
  seat_number: string;
  passenger_name: string;
  ticket_number: string;
  issued_at: Date;
  checked_in_at: Date | null;
  cancelled_at: Date | null;
}

const TICKET_COLUMNS = `t.id, t.booking_id, b.company_id::text AS company_id,
  t.passenger_id::text AS passenger_id, t.seat_reservation_id::text AS seat_reservation_id,
  sr.seat_number, pass.full_name AS passenger_name, t.ticket_number,
  t.issued_at, t.checked_in_at, t.cancelled_at`;

const TICKET_JOINS = `public.tickets t
  JOIN public.bookings b ON b.id = t.booking_id
  JOIN public.passengers pass ON pass.id = t.passenger_id AND pass.booking_id = t.booking_id
  JOIN public.seat_reservations sr ON sr.id = t.seat_reservation_id`;

const IS_PAID = `EXISTS (
  SELECT 1 FROM public.payments pay
   WHERE pay.booking_id = b.id AND pay.status = 'SUCCEEDED'
)`;

@Injectable()
export class PostgresTicketsRepository implements TicketsRepository {
  async findMemberships(
    executor: DatabaseExecutor,
    actorUserId: string,
    companyId: string,
  ): Promise<TicketMembership[]> {
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
      { name: 'tickets.find_actor_memberships' },
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

  async findBookingForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<TicketableBooking | null> {
    return this.findBooking(
      executor,
      `b.id = $1 AND b.booked_by_user_id = $2
       AND b.booking_channel IN ('WEB', 'MOBILE_APP')`,
      [bookingId, ownerUserId],
    );
  }

  async findBookingForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: TicketAccessScope,
    bookingId: string,
  ): Promise<TicketableBooking | null> {
    return this.findBooking(
      executor,
      `b.id = $1 AND b.company_id = $2
       AND ($3::boolean OR b.branch_id = ANY($4::bigint[]))`,
      [bookingId, companyId, scope.companyWide, scope.branchIds],
    );
  }

  private async findBooking(
    executor: DatabaseExecutor,
    where: string,
    params: readonly unknown[],
  ): Promise<TicketableBooking | null> {
    const result = await executor.query<{
      booking_id: string;
      company_id: string;
      branch_id: string | null;
      booked_by_user_id: string | null;
      booking_channel: string;
      status: string;
      is_paid: boolean;
    }>(
      `SELECT b.id AS booking_id, b.company_id::text AS company_id,
              b.branch_id::text AS branch_id, b.booked_by_user_id,
              b.booking_channel::text AS booking_channel, b.status::text AS status,
              ${IS_PAID} AS is_paid
         FROM public.bookings b
        WHERE ${where}
        FOR UPDATE OF b`,
      params,
      { name: 'tickets.find_booking' },
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
          isPaid: row.is_paid,
        }
      : null;
  }

  async listIssuablePassengers(
    executor: DatabaseExecutor,
    bookingId: string,
  ): Promise<IssuablePassenger[]> {
    const result = await executor.query<{
      passenger_id: string;
      seat_reservation_id: string;
    }>(
      `SELECT pass.id::text AS passenger_id, sr.id::text AS seat_reservation_id
         FROM public.passengers pass
         JOIN public.seat_reservations sr
           ON sr.passenger_id = pass.id AND sr.booking_id = pass.booking_id
        WHERE pass.booking_id = $1
          AND sr.status = 'CONFIRMED'
          AND NOT EXISTS (
            SELECT 1 FROM public.tickets t WHERE t.seat_reservation_id = sr.id
          )
        ORDER BY pass.id
        FOR UPDATE OF sr`,
      [bookingId],
      { name: 'tickets.list_issuable_passengers' },
    );
    return result.rows.map((row) => ({
      passengerId: row.passenger_id,
      seatReservationId: row.seat_reservation_id,
    }));
  }

  async insertTicket(
    executor: DatabaseExecutor,
    params: InsertTicketParams,
  ): Promise<string | null> {
    const result = await executor.query<{ id: string }>(
      `INSERT INTO public.tickets
         (booking_id, passenger_id, seat_reservation_id, ticket_number, qr_token_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        params.bookingId,
        params.passengerId,
        params.seatReservationId,
        params.ticketNumber,
        params.qrTokenHash,
      ],
      { name: 'tickets.insert' },
    );
    return result.rows[0]?.id ?? null;
  }

  async findTicketById(
    executor: DatabaseExecutor,
    ticketId: string,
  ): Promise<Ticket | null> {
    return this.findOne(executor, `t.id = $1`, [ticketId]);
  }

  async listTicketsForBookingOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<Ticket[] | null> {
    const booking = await this.findBookingForOwner(executor, ownerUserId, bookingId);
    return booking ? this.listForBooking(executor, bookingId) : null;
  }

  async listTicketsForBookingCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: TicketAccessScope,
    bookingId: string,
  ): Promise<Ticket[] | null> {
    const booking = await this.findBookingForCompany(executor, companyId, scope, bookingId);
    return booking ? this.listForBooking(executor, bookingId) : null;
  }

  private async listForBooking(
    executor: DatabaseExecutor,
    bookingId: string,
  ): Promise<Ticket[]> {
    const result = await executor.query<TicketRow>(
      `SELECT ${TICKET_COLUMNS} FROM ${TICKET_JOINS}
        WHERE t.booking_id = $1
        ORDER BY t.issued_at, t.id`,
      [bookingId],
      { name: 'tickets.list_for_booking' },
    );
    return result.rows.map((row) => this.mapTicket(row));
  }

  async findTicketForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    ticketId: string,
  ): Promise<Ticket | null> {
    return this.findOne(
      executor,
      `t.id = $1 AND b.booked_by_user_id = $2
       AND b.booking_channel IN ('WEB', 'MOBILE_APP')`,
      [ticketId, ownerUserId],
    );
  }

  async findTicketForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: TicketAccessScope,
    ticketId: string,
  ): Promise<Ticket | null> {
    return this.findOne(
      executor,
      `t.id = $1 AND b.company_id = $2
       AND ($3::boolean OR b.branch_id = ANY($4::bigint[]))`,
      [ticketId, companyId, scope.companyWide, scope.branchIds],
    );
  }

  async findTicketByHashForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: TicketAccessScope,
    qrTokenHash: string,
  ): Promise<VerifiableTicket | null> {
    const result = await executor.query<
      TicketRow & { booking_status: string; is_paid: boolean }
    >(
      `SELECT ${TICKET_COLUMNS}, b.status::text AS booking_status, ${IS_PAID} AS is_paid
         FROM ${TICKET_JOINS}
        WHERE t.qr_token_hash = $1 AND b.company_id = $2
          AND ($3::boolean OR b.branch_id = ANY($4::bigint[]))`,
      [qrTokenHash, companyId, scope.companyWide, scope.branchIds],
      { name: 'tickets.find_by_hash' },
    );
    const row = result.rows[0];
    return row
      ? {
          ticket: this.mapTicket(row),
          bookingStatus: row.booking_status,
          isPaid: row.is_paid,
        }
      : null;
  }

  async listTicketsForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    pagination: ResolvedPagination,
  ): Promise<TicketPage> {
    return this.list(
      executor,
      `b.booked_by_user_id = $1 AND b.booking_channel IN ('WEB', 'MOBILE_APP')`,
      [ownerUserId],
      pagination,
    );
  }

  async listTicketsForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: TicketAccessScope,
    pagination: ResolvedPagination,
  ): Promise<TicketPage> {
    return this.list(
      executor,
      `b.company_id = $1 AND ($2::boolean OR b.branch_id = ANY($3::bigint[]))`,
      [companyId, scope.companyWide, scope.branchIds],
      pagination,
    );
  }

  async lockTicketForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: TicketAccessScope,
    ticketId: string,
  ): Promise<LockedTicket | null> {
    const result = await executor.query<{
      id: string;
      booking_id: string;
      company_id: string;
      seat_reservation_id: string;
      booking_status: string;
      is_paid: boolean;
      checked_in_at: Date | null;
      cancelled_at: Date | null;
    }>(
      `SELECT t.id, t.booking_id, b.company_id::text AS company_id,
              t.seat_reservation_id::text AS seat_reservation_id,
              b.status::text AS booking_status, ${IS_PAID} AS is_paid,
              t.checked_in_at, t.cancelled_at
         FROM public.tickets t
         JOIN public.bookings b ON b.id = t.booking_id
        WHERE t.id = $1 AND b.company_id = $2
          AND ($3::boolean OR b.branch_id = ANY($4::bigint[]))
        FOR UPDATE OF t`,
      [ticketId, companyId, scope.companyWide, scope.branchIds],
      { name: 'tickets.lock_for_validation' },
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          bookingId: row.booking_id,
          companyId: row.company_id,
          seatReservationId: row.seat_reservation_id,
          bookingStatus: row.booking_status,
          isPaid: row.is_paid,
          checkedInAt: row.checked_in_at ?? undefined,
          cancelledAt: row.cancelled_at ?? undefined,
        }
      : null;
  }

  async checkInTicket(
    executor: DatabaseExecutor,
    ticketId: string,
  ): Promise<Ticket | null> {
    const updated = await executor.query<{ id: string }>(
      `UPDATE public.tickets
          SET checked_in_at = now()
        WHERE id = $1 AND checked_in_at IS NULL AND cancelled_at IS NULL
        RETURNING id`,
      [ticketId],
      { name: 'tickets.check_in' },
    );
    return updated.rows[0] ? this.findTicketById(executor, ticketId) : null;
  }

  async revokeTicket(
    executor: DatabaseExecutor,
    ticketId: string,
  ): Promise<Ticket | null> {
    const updated = await executor.query<{ id: string }>(
      `UPDATE public.tickets
          SET cancelled_at = now()
        WHERE id = $1 AND cancelled_at IS NULL AND checked_in_at IS NULL
        RETURNING id`,
      [ticketId],
      { name: 'tickets.revoke' },
    );
    return updated.rows[0] ? this.findTicketById(executor, ticketId) : null;
  }

  async checkInSeat(
    executor: DatabaseExecutor,
    seatReservationId: string,
  ): Promise<void> {
    await executor.query(
      `UPDATE public.seat_reservations
          SET status = 'CHECKED_IN', updated_at = now()
        WHERE id = $1 AND status = 'CONFIRMED'`,
      [seatReservationId],
      { name: 'tickets.check_in_seat' },
    );
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
      { name: 'tickets.append_booking_event' },
    );
  }

  private async findOne(
    executor: DatabaseExecutor,
    where: string,
    params: readonly unknown[],
  ): Promise<Ticket | null> {
    const result = await executor.query<TicketRow>(
      `SELECT ${TICKET_COLUMNS} FROM ${TICKET_JOINS} WHERE ${where}`,
      params,
      { name: 'tickets.find_scoped' },
    );
    const row = result.rows[0];
    return row ? this.mapTicket(row) : null;
  }

  private async list(
    executor: DatabaseExecutor,
    where: string,
    params: readonly unknown[],
    pagination: ResolvedPagination,
  ): Promise<TicketPage> {
    const pageParams = [...params, pagination.limit, pagination.offset];
    const result = await executor.query<TicketRow>(
      `SELECT ${TICKET_COLUMNS} FROM ${TICKET_JOINS}
        WHERE ${where}
        ORDER BY t.issued_at DESC, t.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      pageParams,
      { name: 'tickets.list_scoped' },
    );
    const count = await executor.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ${TICKET_JOINS} WHERE ${where}`,
      params,
      { name: 'tickets.count_scoped' },
    );
    return {
      items: result.rows.map((row) => this.mapTicket(row)),
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  private mapTicket(row: TicketRow): Ticket {
    const checkedInAt = row.checked_in_at ?? undefined;
    const cancelledAt = row.cancelled_at ?? undefined;
    return {
      id: row.id,
      bookingId: row.booking_id,
      companyId: row.company_id,
      passengerId: row.passenger_id,
      seatReservationId: row.seat_reservation_id,
      seatNumber: row.seat_number,
      passengerName: row.passenger_name,
      ticketNumber: row.ticket_number,
      status: deriveTicketStatus({ checkedInAt, cancelledAt }),
      issuedAt: row.issued_at,
      checkedInAt,
      cancelledAt,
    };
  }
}
