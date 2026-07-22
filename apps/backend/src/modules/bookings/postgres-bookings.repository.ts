import { Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { parseMembershipRole } from '../identity/membership-role';
import type {
  Booking,
  BookingAccessScope,
  BookingEventPage,
  BookingMembership,
  BookingPage,
  BookingPassenger,
  BookingPassengerInput,
  BookingStatus,
  BookingTripFacts,
  ExpiredBooking,
  IdempotencyClaim,
} from './booking.types';
import { BookingStatus as Status, PassengerGender } from './booking.types';
import type { BookingsRepository, InsertBookingParams } from './bookings.repository';
import { BookingAction, BOOKING_TRANSITIONS } from './booking-transitions';

interface BookingRow {
  id: string;
  booking_reference: string;
  trip_id: string;
  company_id: string;
  branch_id: string | null;
  booked_by_user_id: string | null;
  booking_channel: string;
  booking_source: string;
  status: string;
  ticket_price_snapshot: string;
  subtotal_amount: string;
  service_fee_amount: string;
  discount_amount: string;
  total_amount: string;
  currency: string;
  expires_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const BOOKING_COLUMNS = `b.id, b.booking_reference, b.trip_id::text, b.company_id::text,
  b.branch_id::text, b.booked_by_user_id, b.booking_channel::text,
  b.booking_source::text, b.status::text, b.ticket_price_snapshot::text,
  b.subtotal_amount::text, b.service_fee_amount::text, b.discount_amount::text,
  b.total_amount::text, b.currency, b.expires_at, b.version, b.created_at, b.updated_at`;

@Injectable()
export class PostgresBookingsRepository implements BookingsRepository {
  async findTripCompany(
    executor: DatabaseExecutor,
    tripId: string,
    companyId?: string,
  ): Promise<string | null> {
    const result = await executor.query<{ company_id: string }>(
      `SELECT company_id::text
         FROM public.trips
        WHERE id = $1 AND ($2::bigint IS NULL OR company_id = $2)`,
      [tripId, companyId ?? null],
      { name: 'bookings.find_trip_company' },
    );
    return result.rows[0]?.company_id ?? null;
  }

  async findTripForBooking(
    executor: DatabaseExecutor,
    tripId: string,
    companyId?: string,
  ): Promise<BookingTripFacts | null> {
    const result = await executor.query<{
      trip_id: string;
      company_id: string;
      price: string;
      currency: string;
      status: string;
      is_active: boolean;
      boarding_closes_at: Date;
      seat_hold_minutes: number;
      cancellation_policy: Record<string, unknown>;
    }>(
      `SELECT t.id::text AS trip_id, t.company_id::text AS company_id,
              t.price_mru::text AS price, t.currency, t.status::text, t.is_active,
              t.boarding_closes_at, s.seat_hold_minutes, s.cancellation_policy
         FROM public.trips t
         JOIN public.companies c ON c.id = t.company_id
         JOIN public.company_settings s ON s.company_id = t.company_id
         JOIN public.routes route
           ON route.id = t.route_id AND route.company_id = t.company_id
         JOIN public.stations origin ON origin.id = route.origin_station_id
         JOIN public.stations destination ON destination.id = route.destination_station_id
         JOIN public.buses bus
           ON bus.id = t.bus_id AND bus.company_id = t.company_id
         WHERE t.id = $1
           AND ($2::bigint IS NULL OR t.company_id = $2)
           AND c.is_active AND c.archived_at IS NULL
           AND route.is_active AND route.deleted_at IS NULL
           AND origin.is_active AND origin.deleted_at IS NULL
           AND destination.is_active AND destination.deleted_at IS NULL
           AND bus.is_active AND bus.deleted_at IS NULL AND bus.status = 'ACTIVE'
         FOR SHARE OF t, c, s, route, origin, destination, bus`,
      [tripId, companyId ?? null],
      { name: 'bookings.find_trip_for_booking' },
    );
    const row = result.rows[0];
    return row
      ? {
          tripId: row.trip_id,
          companyId: row.company_id,
          price: row.price,
          currency: row.currency,
          status: row.status,
          isActive: row.is_active,
          boardingClosesAt: row.boarding_closes_at,
          seatHoldMinutes: row.seat_hold_minutes,
          cancellationPolicy: row.cancellation_policy,
        }
      : null;
  }

  async findMemberships(
    executor: DatabaseExecutor,
    actorUserId: string,
    companyId: string,
  ): Promise<BookingMembership[]> {
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
      { name: 'bookings.find_actor_memberships' },
    );
    return result.rows.flatMap((row) => {
      const role = parseMembershipRole(row.role);
      return role
        ? [{
            id: row.id,
            userId: row.user_id,
            companyId: row.company_id,
            branchId: row.branch_id ?? undefined,
            role,
            isActive: row.is_active,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }]
        : [];
    });
  }

  async releaseExpired(
    executor: DatabaseExecutor,
    companyId: string,
    tripId?: string,
  ): Promise<ExpiredBooking[]> {
    const result = await executor.query<{ id: string; company_id: string }>(
      `WITH expired AS (
         UPDATE public.bookings
            SET status = 'EXPIRED', version = version + 1, updated_at = now()
          WHERE company_id = $1
            AND ($2::bigint IS NULL OR trip_id = $2)
            AND status = ANY($3::public.booking_status_enum[])
            AND expires_at <= now()
          RETURNING id, company_id
       ), released AS (
         UPDATE public.seat_reservations seat
            SET status = 'RELEASED', updated_at = now()
           FROM expired
          WHERE seat.booking_id = expired.id AND seat.status = 'HELD'
          RETURNING seat.id
       )
       SELECT id, company_id::text FROM expired`,
      [companyId, tripId ?? null, BOOKING_TRANSITIONS[BookingAction.Expire].from],
      { name: 'bookings.release_expired' },
    );
    return result.rows.map((row) => ({ id: row.id, companyId: row.company_id }));
  }

  async claimIdempotency(
    executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    operation: string,
    key: string,
    fingerprint: string,
  ): Promise<IdempotencyClaim> {
    const inserted = await executor.query<{ id: string }>(
      `INSERT INTO public.idempotency_records
         (company_id, actor_user_id, operation, idempotency_key, request_fingerprint)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company_id, actor_user_id, operation, idempotency_key)
       DO UPDATE SET
         request_fingerprint = EXCLUDED.request_fingerprint,
         booking_id = NULL,
         response_status = NULL,
         completed_at = NULL,
         expires_at = now() + interval '24 hours',
         created_at = now()
       WHERE idempotency_records.expires_at <= now()
       RETURNING id::text`,
      [companyId, actorUserId, operation, key, fingerprint],
      { name: 'bookings.claim_idempotency' },
    );
    if (inserted.rows[0]) {
      return { kind: 'claimed' };
    }

    const existing = await executor.query<{
      request_fingerprint: string;
      booking_id: string | null;
    }>(
      `SELECT request_fingerprint, booking_id
         FROM public.idempotency_records
         WHERE company_id = $1 AND actor_user_id = $2
           AND operation = $3 AND idempotency_key = $4
         FOR UPDATE`,
      [companyId, actorUserId, operation, key],
      { name: 'bookings.lock_idempotency' },
    );
    const row = existing.rows[0];
    if (!row || row.request_fingerprint !== fingerprint) {
      return { kind: 'conflict' };
    }
    return row.booking_id
      ? { kind: 'replay', bookingId: row.booking_id }
      : { kind: 'conflict' };
  }

  async completeIdempotency(
    executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    operation: string,
    key: string,
    bookingId: string,
  ): Promise<void> {
    await executor.query(
      `UPDATE public.idempotency_records
          SET booking_id = $5, response_status = 201, completed_at = now()
        WHERE company_id = $1 AND actor_user_id = $2
          AND operation = $3 AND idempotency_key = $4
          AND booking_id IS NULL`,
      [companyId, actorUserId, operation, key, bookingId],
      { name: 'bookings.complete_idempotency' },
    );
  }

  async insertBooking(executor: DatabaseExecutor, params: InsertBookingParams): Promise<string | null> {
    const result = await executor.query<{ id: string }>(
      `INSERT INTO public.bookings
         (booking_reference, trip_id, company_id, branch_id, booked_by_user_id,
          booking_channel, status, subtotal_amount, service_fee_amount,
          discount_amount, total_amount, currency, expires_at,
          cancellation_policy_snapshot, ticket_price_snapshot)
       SELECT $3, t.id, t.company_id, $4, $5, $6::public.booking_channel_enum,
              'HELD', t.price_mru * $7::integer, 0, 0,
              t.price_mru * $7::integer, t.currency,
              now() + make_interval(mins => s.seat_hold_minutes),
              s.cancellation_policy, t.price_mru
         FROM public.trips t
         JOIN public.company_settings s ON s.company_id = t.company_id
         JOIN public.companies company ON company.id = t.company_id
         JOIN public.routes route
           ON route.id = t.route_id AND route.company_id = t.company_id
         JOIN public.stations origin ON origin.id = route.origin_station_id
         JOIN public.stations destination ON destination.id = route.destination_station_id
         JOIN public.buses bus
           ON bus.id = t.bus_id AND bus.company_id = t.company_id
        WHERE t.id = $1 AND t.company_id = $2 AND t.is_active
          AND t.status = 'SCHEDULED' AND now() < t.boarding_closes_at
          AND company.is_active AND company.archived_at IS NULL
          AND route.is_active AND route.deleted_at IS NULL
          AND origin.is_active AND origin.deleted_at IS NULL
          AND destination.is_active AND destination.deleted_at IS NULL
          AND bus.is_active AND bus.deleted_at IS NULL AND bus.status = 'ACTIVE'
       ON CONFLICT (booking_reference) DO NOTHING
       RETURNING id`,
      [
        params.tripId,
        params.companyId,
        params.bookingReference,
        params.branchId ?? null,
        params.actorUserId,
        params.bookingChannel,
        params.passengerCount,
      ],
      { name: 'bookings.insert' },
    );
    return result.rows[0]?.id ?? null;
  }

  async insertPassenger(
    executor: DatabaseExecutor,
    bookingId: string,
    passenger: BookingPassengerInput,
  ): Promise<string> {
    const result = await executor.query<{ id: string }>(
      `INSERT INTO public.passengers
         (booking_id, full_name, phone, document_number, boarding_station_id, gender)
       VALUES ($1, $2, $3, $4, $5, $6::public.passenger_gender_enum)
       RETURNING id::text`,
      [
        bookingId,
        passenger.fullName.trim(),
        passenger.phone ?? null,
        passenger.documentNumber?.trim() ?? null,
        passenger.boardingStationId ?? null,
        passenger.gender ?? PassengerGender.Unspecified,
      ],
      { name: 'bookings.insert_passenger' },
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('passenger insert returned no row');
    return id;
  }

  async insertSeat(
    executor: DatabaseExecutor,
    tripId: string,
    bookingId: string,
    passengerId: string,
    seatId: string,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO public.seat_reservations
         (trip_id, booking_id, passenger_id, seat_number, status, held_until)
       SELECT $1, $2, $3, $4, 'HELD', expires_at
         FROM public.bookings
         WHERE id = $2 AND trip_id = $1`,
      [tripId, bookingId, passengerId, seatId],
      { name: 'bookings.insert_seat_reservation' },
    );
  }

  async appendEvent(
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
      { name: 'bookings.append_event' },
    );
  }

  async findForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<Booking | null> {
    return this.findOne(
      executor,
      `b.id = $1 AND b.booked_by_user_id = $2
       AND b.booking_channel IN ('WEB', 'MOBILE_APP')`,
      [bookingId, ownerUserId],
    );
  }

  async findForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    _actorUserId: string,
    scope: BookingAccessScope,
    bookingId: string,
  ): Promise<Booking | null> {
    return this.findOne(
      executor,
      `b.id = $1 AND b.company_id = $2
       AND ($3::boolean OR b.branch_id = ANY($4::bigint[]))`,
      [bookingId, companyId, scope.companyWide, scope.branchIds],
    );
  }

  async listForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingPage> {
    return this.list(
      executor,
      `b.booked_by_user_id = $1
       AND b.booking_channel IN ('WEB', 'MOBILE_APP')`,
      [ownerUserId],
      pagination,
    );
  }

  async listForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    _actorUserId: string,
    scope: BookingAccessScope,
    pagination: ResolvedPagination,
  ): Promise<BookingPage> {
    return this.list(
      executor,
      `b.company_id = $1
       AND ($2::boolean OR b.branch_id = ANY($3::bigint[]))`,
      [companyId, scope.companyWide, scope.branchIds],
      pagination,
    );
  }

  async listEventsForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingEventPage | null> {
    const booking = await this.findForOwner(executor, ownerUserId, bookingId);
    return booking
      ? this.listEvents(executor, booking.id, booking.companyId, pagination)
      : null;
  }

  async listEventsForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    scope: BookingAccessScope,
    bookingId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingEventPage | null> {
    const booking = await this.findForCompany(executor, companyId, actorUserId, scope, bookingId);
    return booking
      ? this.listEvents(executor, booking.id, companyId, pagination)
      : null;
  }

  async cancelForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<{ companyId: string; status: BookingStatus } | null> {
    return this.cancel(
      executor,
      `id = $1 AND booked_by_user_id = $2
       AND booking_channel IN ('WEB', 'MOBILE_APP')`,
      [bookingId, ownerUserId],
    );
  }

  async lockOwnedBookingForCancellation(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<boolean> {
    return this.lockBookingAggregate(
      executor,
      bookingId,
      `b.id = $1 AND b.booked_by_user_id = $2
       AND b.booking_channel IN ('WEB', 'MOBILE_APP')`,
      [bookingId, ownerUserId],
    );
  }

  async lockCompanyBookingForCancellation(
    executor: DatabaseExecutor,
    companyId: string,
    scope: BookingAccessScope,
    bookingId: string,
  ): Promise<boolean> {
    return this.lockBookingAggregate(
      executor,
      bookingId,
      `b.id = $1 AND b.company_id = $2
       AND ($3::boolean OR b.branch_id = ANY($4::bigint[]))`,
      [bookingId, companyId, scope.companyWide, scope.branchIds],
    );
  }

  private async lockBookingAggregate(
    executor: DatabaseExecutor,
    bookingId: string,
    where: string,
    params: readonly unknown[],
  ): Promise<boolean> {
    const booking = await executor.query<{ id: string }>(
      `SELECT b.id
         FROM public.bookings b
        WHERE ${where}
        FOR UPDATE OF b`,
      params,
      { name: 'bookings.lock_scoped_for_cancellation' },
    );
    if (!booking.rows[0]) return false;
    await executor.query(
      `SELECT id
         FROM public.seat_reservations
        WHERE booking_id = $1
        ORDER BY id
        FOR UPDATE`,
      [bookingId],
      { name: 'bookings.lock_seats_for_cancellation' },
    );
    return true;
  }

  async cancelForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    _actorUserId: string,
    scope: BookingAccessScope,
    bookingId: string,
  ): Promise<{ companyId: string; status: BookingStatus } | null> {
    return this.cancel(
      executor,
      `id = $1 AND company_id = $2
       AND ($3::boolean OR branch_id = ANY($4::bigint[]))`,
      [bookingId, companyId, scope.companyWide, scope.branchIds],
    );
  }

  async releaseBookingSeats(executor: DatabaseExecutor, bookingId: string): Promise<void> {
    await executor.query(
      `UPDATE public.seat_reservations
          SET status = 'CANCELLED', updated_at = now()
        WHERE booking_id = $1 AND status IN ('HELD', 'CONFIRMED')`,
      [bookingId],
      { name: 'bookings.cancel_seats' },
    );
  }

  private async findOne(
    executor: DatabaseExecutor,
    where: string,
    params: readonly unknown[],
  ): Promise<Booking | null> {
    const result = await executor.query<BookingRow>(
      `SELECT ${BOOKING_COLUMNS} FROM public.bookings b WHERE ${where}`,
      params,
      { name: 'bookings.find_scoped' },
    );
    const row = result.rows[0];
    return row ? this.mapBooking(executor, row) : null;
  }

  private async list(
    executor: DatabaseExecutor,
    where: string,
    params: readonly unknown[],
    pagination: ResolvedPagination,
  ): Promise<BookingPage> {
    const pageParams = [...params, pagination.limit, pagination.offset];
    const result = await executor.query<BookingRow>(
      `SELECT ${BOOKING_COLUMNS} FROM public.bookings b
        WHERE ${where}
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      pageParams,
      { name: 'bookings.list_scoped' },
    );
    const count = await executor.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM public.bookings b WHERE ${where}`,
      params,
      { name: 'bookings.count_scoped' },
    );
    const items = await Promise.all(result.rows.map((row) => this.mapBooking(executor, row)));
    return { items, total: Number(count.rows[0]?.total ?? 0) };
  }

  private async mapBooking(executor: DatabaseExecutor, row: BookingRow): Promise<Booking> {
    const status = this.status(row.status);
    const passengers = await this.listPassengers(executor, row.id);
    return {
      id: row.id,
      bookingReference: row.booking_reference,
      tripId: row.trip_id,
      companyId: row.company_id,
      branchId: row.branch_id ?? undefined,
      bookedByUserId: row.booked_by_user_id ?? undefined,
      bookingChannel: row.booking_channel,
      bookingSource: row.booking_source,
      status,
      unitPrice: row.ticket_price_snapshot,
      subtotalAmount: row.subtotal_amount,
      serviceFeeAmount: row.service_fee_amount,
      discountAmount: row.discount_amount,
      totalAmount: row.total_amount,
      currency: row.currency,
      expiresAt: row.expires_at ?? undefined,
      version: row.version,
      passengers,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async listPassengers(
    executor: DatabaseExecutor,
    bookingId: string,
  ): Promise<BookingPassenger[]> {
    const result = await executor.query<{
      id: string;
      full_name: string;
      phone: string | null;
      document_number: string | null;
      boarding_station_id: string | null;
      gender: string;
      seat_number: string;
    }>(
      `SELECT p.id::text, p.full_name, p.phone, p.document_number,
              p.boarding_station_id::text, p.gender::text, s.seat_number
         FROM public.passengers p
         JOIN public.seat_reservations s
           ON s.passenger_id = p.id AND s.booking_id = p.booking_id
        WHERE p.booking_id = $1
        ORDER BY p.id`,
      [bookingId],
      { name: 'bookings.list_passengers' },
    );
    return result.rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      phone: row.phone ?? undefined,
      documentNumber: row.document_number ?? undefined,
      boardingStationId: row.boarding_station_id ?? undefined,
      gender: this.gender(row.gender),
      seatId: row.seat_number,
    }));
  }

  private async listEvents(
    executor: DatabaseExecutor,
    bookingId: string,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingEventPage> {
    const result = await executor.query<{ id: string; event_type: string; event_time: Date }>(
      `SELECT id::text, event_type::text, event_time
         FROM public.booking_events
        WHERE booking_id = $1 AND company_id = $2
        ORDER BY event_time DESC, id DESC
        LIMIT $3 OFFSET $4`,
      [bookingId, companyId, pagination.limit, pagination.offset],
      { name: 'bookings.list_events' },
    );
    const count = await executor.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM public.booking_events
        WHERE booking_id = $1 AND company_id = $2`,
      [bookingId, companyId],
      { name: 'bookings.count_events' },
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        eventTime: row.event_time,
      })),
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  private async cancel(
    executor: DatabaseExecutor,
    where: string,
    params: readonly unknown[],
  ): Promise<{ companyId: string; status: BookingStatus } | null> {
    const sourceStatuses = BOOKING_TRANSITIONS[BookingAction.Cancel].from;
    const result = await executor.query<{ company_id: string; status: string }>(
      `UPDATE public.bookings booking
          SET status = 'CANCELLED', version = version + 1, updated_at = now()
        WHERE ${where}
          AND status = ANY($${params.length + 1}::public.booking_status_enum[])
          AND NOT EXISTS (
            SELECT 1 FROM public.seat_reservations seat
             WHERE seat.booking_id = booking.id AND seat.status = 'CHECKED_IN'
          )
        RETURNING company_id::text, status::text`,
      [...params, sourceStatuses],
      { name: 'bookings.cancel_scoped' },
    );
    const row = result.rows[0];
    return row ? { companyId: row.company_id, status: this.status(row.status) } : null;
  }

  private status(value: string): BookingStatus {
    if ((Object.values(Status) as string[]).includes(value)) return value as BookingStatus;
    throw new Error('database returned an unknown booking status');
  }

  private gender(value: string): PassengerGender {
    if ((Object.values(PassengerGender) as string[]).includes(value)) return value as PassengerGender;
    throw new Error('database returned an unknown passenger gender');
  }
}
