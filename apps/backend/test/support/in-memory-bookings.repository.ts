import type { ResolvedPagination } from '../../src/common/pagination/pagination';
import { UniqueConstraintViolationError } from '../../src/infrastructure/database';
import type { DatabaseExecutor } from '../../src/infrastructure/database/database.types';
import type {
  BookingsRepository,
  InsertBookingParams,
} from '../../src/modules/bookings/bookings.repository';
import {
  BookingStatus,
  PassengerGender,
  type Booking,
  type BookingAccessScope,
  type BookingEvent,
  type BookingEventPage,
  type BookingMembership,
  type BookingPage,
  type BookingPassengerInput,
  type BookingTripFacts,
  type ExpiredBooking,
  type IdempotencyClaim,
} from '../../src/modules/bookings/booking.types';
import type { MembershipRole } from '../../src/modules/identity/membership-role';
import {
  BookingAction,
  canApplyBookingAction,
} from '../../src/modules/bookings/booking-transitions';

interface MembershipSeed {
  readonly id?: string;
  readonly userId: string;
  readonly companyId: string;
  readonly branchId?: string;
  readonly role: MembershipRole;
}

interface IdempotencyRecord {
  readonly fingerprint: string;
  bookingId?: string;
}

interface PendingPassenger {
  readonly bookingId: string;
  readonly input: BookingPassengerInput;
}

const ACTIVE_SEAT_STATUSES: readonly BookingStatus[] = [
  BookingStatus.Held,
  BookingStatus.PendingPayment,
  BookingStatus.Confirmed,
];

/** In-memory booking adapter preserving the access and state semantics used by HTTP tests. */
export class InMemoryBookingsRepository implements BookingsRepository {
  private readonly trips = new Map<string, BookingTripFacts>();
  private readonly memberships: BookingMembership[] = [];
  private readonly bookings = new Map<string, Booking>();
  private readonly events = new Map<string, BookingEvent[]>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly pendingPassengers = new Map<string, PendingPassenger>();
  private bookingSequence = 0;
  private passengerSequence = 0;
  private eventSequence = 0;
  private membershipSequence = 0;
  private failWith: Error | null = null;

  get bookingCount(): number {
    return this.bookings.size;
  }

  addTrip(overrides: Partial<BookingTripFacts> = {}): BookingTripFacts {
    const trip: BookingTripFacts = {
      tripId: '100',
      companyId: '10',
      price: '500.00',
      currency: 'MRU',
      status: 'SCHEDULED',
      isActive: true,
      boardingClosesAt: new Date('2099-01-01T00:00:00.000Z'),
      seatHoldMinutes: 15,
      cancellationPolicy: {},
      ...overrides,
    };
    this.trips.set(trip.tripId, trip);
    return trip;
  }

  addMembership(seed: MembershipSeed): BookingMembership {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const membership: BookingMembership = {
      id: seed.id ?? String(++this.membershipSequence),
      userId: seed.userId,
      companyId: seed.companyId,
      branchId: seed.branchId,
      role: seed.role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    this.memberships.push(membership);
    return membership;
  }

  addBooking(overrides: Partial<Booking> = {}): Booking {
    const now = new Date('2026-07-22T12:00:00.000Z');
    const id = overrides.id ?? this.nextUuid(++this.bookingSequence);
    const booking: Booking = {
      id,
      bookingReference: `VYG-TEST-${this.bookingSequence}`,
      tripId: '100',
      companyId: '10',
      bookedByUserId: '11111111-1111-4111-8111-111111111111',
      bookingChannel: 'WEB',
      bookingSource: 'WEB',
      status: BookingStatus.Held,
      unitPrice: '500.00',
      subtotalAmount: '500.00',
      serviceFeeAmount: '0.00',
      discountAmount: '0.00',
      totalAmount: '500.00',
      currency: 'MRU',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      version: 1,
      passengers: [],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    this.bookings.set(id, booking);
    return booking;
  }

  failNextWith(error: Error): void {
    this.failWith = error;
  }

  findTripCompany(
    _executor: DatabaseExecutor,
    tripId: string,
    companyId?: string,
  ): Promise<string | null> {
    const trip = this.trips.get(tripId);
    return Promise.resolve(
      trip && (!companyId || trip.companyId === companyId)
        ? trip.companyId
        : null,
    );
  }

  findTripForBooking(
    _executor: DatabaseExecutor,
    tripId: string,
    companyId?: string,
  ): Promise<BookingTripFacts | null> {
    this.maybeFail();
    const trip = this.trips.get(tripId);
    return Promise.resolve(
      trip && (!companyId || trip.companyId === companyId) ? trip : null,
    );
  }

  findMemberships(
    _executor: DatabaseExecutor,
    actorUserId: string,
    companyId: string,
  ): Promise<BookingMembership[]> {
    this.maybeFail();
    return Promise.resolve(
      this.memberships.filter(
        (membership) =>
          membership.userId === actorUserId &&
          membership.companyId === companyId &&
          membership.isActive,
      ),
    );
  }

  releaseExpired(
    _executor: DatabaseExecutor,
    companyId: string,
    tripId?: string,
  ): Promise<ExpiredBooking[]> {
    this.maybeFail();
    const expired: ExpiredBooking[] = [];
    for (const booking of this.bookings.values()) {
      if (
        booking.companyId === companyId &&
        (!tripId || booking.tripId === tripId) &&
        (booking.status === BookingStatus.Held ||
          booking.status === BookingStatus.PendingPayment) &&
        booking.expiresAt &&
        booking.expiresAt <= new Date()
      ) {
        this.replaceBooking(booking.id, {
          status: BookingStatus.Expired,
          version: booking.version + 1,
          updatedAt: new Date(),
        });
        expired.push({ id: booking.id, companyId: booking.companyId });
      }
    }
    return Promise.resolve(expired);
  }

  claimIdempotency(
    _executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    operation: string,
    key: string,
    fingerprint: string,
  ): Promise<IdempotencyClaim> {
    this.maybeFail();
    const scopedKey = this.idempotencyKey(
      companyId,
      actorUserId,
      operation,
      key,
    );
    const existing = this.idempotency.get(scopedKey);
    if (!existing) {
      this.idempotency.set(scopedKey, { fingerprint });
      return Promise.resolve({ kind: 'claimed' });
    }
    if (existing.fingerprint !== fingerprint || !existing.bookingId) {
      return Promise.resolve({ kind: 'conflict' });
    }
    return Promise.resolve({ kind: 'replay', bookingId: existing.bookingId });
  }

  completeIdempotency(
    _executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    operation: string,
    key: string,
    bookingId: string,
  ): Promise<void> {
    this.maybeFail();
    const record = this.idempotency.get(
      this.idempotencyKey(companyId, actorUserId, operation, key),
    );
    if (record) record.bookingId = bookingId;
    return Promise.resolve();
  }

  insertBooking(
    _executor: DatabaseExecutor,
    params: InsertBookingParams,
  ): Promise<string | null> {
    this.maybeFail();
    const trip = this.trips.get(params.tripId);
    if (
      !trip ||
      trip.companyId !== params.companyId ||
      !trip.isActive ||
      trip.status !== 'SCHEDULED' ||
      new Date() >= trip.boardingClosesAt
    ) {
      return Promise.resolve(null);
    }
    if (
      [...this.bookings.values()].some(
        (booking) => booking.bookingReference === params.bookingReference,
      )
    ) {
      return Promise.resolve(null);
    }
    const now = new Date();
    const subtotal = (Number(trip.price) * params.passengerCount).toFixed(2);
    return Promise.resolve(
      this.addBooking({
        bookingReference: params.bookingReference,
        tripId: params.tripId,
        companyId: params.companyId,
        branchId: params.branchId,
        bookedByUserId: params.actorUserId,
        bookingChannel: params.bookingChannel,
        bookingSource: params.bookingChannel,
        subtotalAmount: subtotal,
        totalAmount: subtotal,
        unitPrice: trip.price,
        currency: trip.currency,
        expiresAt: new Date(now.getTime() + trip.seatHoldMinutes * 60_000),
        createdAt: now,
        updatedAt: now,
      }).id,
    );
  }

  insertPassenger(
    _executor: DatabaseExecutor,
    bookingId: string,
    passenger: BookingPassengerInput,
  ): Promise<string> {
    this.maybeFail();
    const id = String(++this.passengerSequence);
    this.pendingPassengers.set(id, { bookingId, input: passenger });
    return Promise.resolve(id);
  }

  insertSeat(
    _executor: DatabaseExecutor,
    tripId: string,
    bookingId: string,
    passengerId: string,
    seatId: string,
  ): Promise<void> {
    this.maybeFail();
    const occupied = [...this.bookings.values()].some(
      (booking) =>
        booking.tripId === tripId &&
        booking.id !== bookingId &&
        ACTIVE_SEAT_STATUSES.includes(booking.status) &&
        booking.passengers.some((passenger) => passenger.seatId === seatId),
    );
    if (occupied) throw new UniqueConstraintViolationError();

    const pending = this.pendingPassengers.get(passengerId);
    const booking = this.bookings.get(bookingId);
    if (!pending || pending.bookingId !== bookingId || !booking) {
      throw new Error('unknown in-memory passenger or booking');
    }
    this.replaceBooking(bookingId, {
      passengers: [
        ...booking.passengers,
        {
          id: passengerId,
          fullName: pending.input.fullName.trim(),
          phone: pending.input.phone,
          documentNumber: pending.input.documentNumber?.trim(),
          boardingStationId: pending.input.boardingStationId,
          gender: pending.input.gender ?? PassengerGender.Unspecified,
          seatId,
        },
      ],
    });
    this.pendingPassengers.delete(passengerId);
    return Promise.resolve();
  }

  appendEvent(
    _executor: DatabaseExecutor,
    bookingId: string,
    _companyId: string,
    _actorUserId: string | null,
    eventType: string,
  ): Promise<void> {
    this.maybeFail();
    const event: BookingEvent = {
      id: String(++this.eventSequence),
      eventType,
      eventTime: new Date(),
    };
    this.events.set(bookingId, [event, ...(this.events.get(bookingId) ?? [])]);
    return Promise.resolve();
  }

  findForOwner(
    _executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<Booking | null> {
    this.maybeFail();
    const booking = this.bookings.get(bookingId);
    return Promise.resolve(
      booking?.bookedByUserId === ownerUserId &&
        ['WEB', 'MOBILE_APP'].includes(booking.bookingChannel)
        ? booking
        : null,
    );
  }

  findForCompany(
    _executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    scope: BookingAccessScope,
    bookingId: string,
  ): Promise<Booking | null> {
    this.maybeFail();
    const booking = this.bookings.get(bookingId);
    return Promise.resolve(
      booking && this.canAccess(booking, companyId, actorUserId, scope)
        ? booking
        : null,
    );
  }

  listForOwner(
    _executor: DatabaseExecutor,
    ownerUserId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingPage> {
    this.maybeFail();
    return Promise.resolve(
      this.paginate(
        [...this.bookings.values()].filter(
          (booking) =>
            booking.bookedByUserId === ownerUserId &&
            ['WEB', 'MOBILE_APP'].includes(booking.bookingChannel),
        ),
        pagination,
      ),
    );
  }

  listForCompany(
    _executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    scope: BookingAccessScope,
    pagination: ResolvedPagination,
  ): Promise<BookingPage> {
    this.maybeFail();
    return Promise.resolve(
      this.paginate(
        [...this.bookings.values()].filter((booking) =>
          this.canAccess(booking, companyId, actorUserId, scope),
        ),
        pagination,
      ),
    );
  }

  async listEventsForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingEventPage | null> {
    const booking = await this.findForOwner(executor, ownerUserId, bookingId);
    return booking ? this.eventPage(bookingId, pagination) : null;
  }

  async listEventsForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    scope: BookingAccessScope,
    bookingId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingEventPage | null> {
    const booking = await this.findForCompany(
      executor,
      companyId,
      actorUserId,
      scope,
      bookingId,
    );
    return booking ? this.eventPage(bookingId, pagination) : null;
  }

  cancelForOwner(
    _executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<{ companyId: string; status: BookingStatus } | null> {
    this.maybeFail();
    const booking = this.bookings.get(bookingId);
    return Promise.resolve(
      booking?.bookedByUserId === ownerUserId &&
        ['WEB', 'MOBILE_APP'].includes(booking.bookingChannel)
        ? this.cancel(booking)
        : null,
    );
  }

  lockOwnedBookingForCancellation(
    _executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<boolean> {
    this.maybeFail();
    const booking = this.bookings.get(bookingId);
    return Promise.resolve(
      booking?.bookedByUserId === ownerUserId &&
        ['WEB', 'MOBILE_APP'].includes(booking.bookingChannel),
    );
  }

  lockCompanyBookingForCancellation(
    _executor: DatabaseExecutor,
    companyId: string,
    scope: BookingAccessScope,
    bookingId: string,
  ): Promise<boolean> {
    this.maybeFail();
    const booking = this.bookings.get(bookingId);
    return Promise.resolve(
      Boolean(booking && this.canAccess(booking, companyId, '', scope)),
    );
  }

  cancelForCompany(
    _executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    scope: BookingAccessScope,
    bookingId: string,
  ): Promise<{ companyId: string; status: BookingStatus } | null> {
    this.maybeFail();
    const booking = this.bookings.get(bookingId);
    return Promise.resolve(
      booking && this.canAccess(booking, companyId, actorUserId, scope)
        ? this.cancel(booking)
        : null,
    );
  }

  releaseBookingSeats(
    _executor: DatabaseExecutor,
    _bookingId: string,
  ): Promise<void> {
    this.maybeFail();
    return Promise.resolve();
  }

  private cancel(
    booking: Booking,
  ): { companyId: string; status: BookingStatus } | null {
    if (!canApplyBookingAction(booking.status, BookingAction.Cancel)) return null;
    this.replaceBooking(booking.id, {
      status: BookingStatus.Cancelled,
      version: booking.version + 1,
      updatedAt: new Date(),
    });
    return { companyId: booking.companyId, status: BookingStatus.Cancelled };
  }

  private canAccess(
    booking: Booking,
    companyId: string,
    _actorUserId: string,
    scope: BookingAccessScope,
  ): boolean {
    return (
      booking.companyId === companyId &&
      (scope.companyWide ||
        (booking.branchId !== undefined &&
          scope.branchIds.includes(booking.branchId)))
    );
  }

  private paginate(
    bookings: Booking[],
    pagination: ResolvedPagination,
  ): BookingPage {
    const sorted = bookings.sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
    return {
      items: sorted.slice(
        pagination.offset,
        pagination.offset + pagination.limit,
      ),
      total: sorted.length,
    };
  }

  private eventPage(
    bookingId: string,
    pagination: ResolvedPagination,
  ): BookingEventPage {
    const events = this.events.get(bookingId) ?? [];
    return {
      items: events.slice(
        pagination.offset,
        pagination.offset + pagination.limit,
      ),
      total: events.length,
    };
  }

  private replaceBooking(id: string, changes: Partial<Booking>): Booking {
    const current = this.bookings.get(id);
    if (!current) throw new Error('unknown in-memory booking');
    const updated = { ...current, ...changes };
    this.bookings.set(id, updated);
    return updated;
  }

  private idempotencyKey(
    companyId: string,
    actorUserId: string,
    operation: string,
    key: string,
  ): string {
    return `${companyId}:${actorUserId}:${operation}:${key}`;
  }

  private nextUuid(sequence: number): string {
    return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  }

  private maybeFail(): void {
    if (!this.failWith) return;
    const error = this.failWith;
    this.failWith = null;
    throw error;
  }
}
