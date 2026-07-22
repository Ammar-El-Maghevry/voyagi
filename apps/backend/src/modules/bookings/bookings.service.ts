import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import {
  CheckConstraintViolationError,
  DatabaseService,
  ForeignKeyViolationError,
  TransactionManager,
  UniqueConstraintViolationError,
} from '../../infrastructure/database';
import { Permission } from '../authorization/permission.enum';
import { AUDIT_WRITER, type AuditWriterPort } from '../audit/audit.service';
import {
  canExercisePermissionInBranch,
  resolveEntitlements,
  type Entitlement,
} from '../identity/entitlements';
import { isUuid, parsePositiveBigInt } from '../identity/identifier.util';
import {
  BookingBranchForbiddenError,
  BookingNotCancellableError,
  BookingNotFoundError,
  BookingReferenceUnavailableError,
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  InvalidSeatSelectionError,
  SeatAlreadyReservedError,
  TripNotBookableError,
} from './booking.errors';
import {
  BOOKINGS_REPOSITORY,
  type BookingsRepository,
} from './bookings.repository';
import type {
  Booking,
  BookingAccessScope,
  BookingEventPage,
  BookingPage,
  CreateBookingInput,
} from './booking.types';
import { PassengerGender } from './booking.types';
import { BookingReferenceGenerator } from './booking-reference.generator';

const PASSENGER_OPERATION = 'CREATE_PASSENGER_BOOKING';
const AGENT_OPERATION = 'CREATE_AGENT_BOOKING';
const IDEMPOTENCY_KEY = /^[\x21-\x7E]{1,255}$/;
const PHONE = /^\+?[0-9]{8,20}$/;

@Injectable()
export class BookingsService {
  constructor(
    @Inject(BOOKINGS_REPOSITORY) private readonly repository: BookingsRepository,
    private readonly db: DatabaseService,
    private readonly transactions: TransactionManager,
    @Optional()
    private readonly references: BookingReferenceGenerator = new BookingReferenceGenerator(),
    @Optional() @Inject(AUDIT_WRITER) private readonly audit?: AuditWriterPort,
  ) {}

  async createPassengerBooking(
    actorUserId: string,
    idempotencyKey: string | undefined,
    input: CreateBookingInput,
  ): Promise<Booking> {
    const normalized = this.normalizeInput(input);
    this.validateCreate(actorUserId, idempotencyKey, normalized);
    const key = idempotencyKey as string;
    const fingerprint = this.fingerprint({ operation: PASSENGER_OPERATION, input: normalized });

    return this.transactions.run(async (tx) => {
      const companyId = await this.repository.findTripCompany(tx, normalized.tripId);
      if (!companyId) throw new TripNotBookableError();

      const claim = await this.repository.claimIdempotency(
        tx,
        companyId,
        actorUserId,
        PASSENGER_OPERATION,
        key,
        fingerprint,
      );
      if (claim.kind === 'conflict') throw new IdempotencyConflictError();
      if (claim.kind === 'replay') {
        const replay = await this.repository.findForOwner(tx, actorUserId, claim.bookingId as string);
        if (!replay) throw new BookingNotFoundError();
        return replay;
      }

      const trip = await this.repository.findTripForBooking(tx, normalized.tripId, companyId);
      if (!trip) throw new TripNotBookableError();

      return this.createClaimed(
        tx,
        trip,
        actorUserId,
        undefined,
        'WEB',
        PASSENGER_OPERATION,
        key,
        normalized,
      );
    });
  }

  async createAgentBooking(
    actorUserId: string,
    companyId: string,
    branchId: string,
    idempotencyKey: string | undefined,
    input: CreateBookingInput,
  ): Promise<Booking> {
    const normalized = this.normalizeInput(input);
    this.validateCreate(actorUserId, idempotencyKey, normalized);
    const company = parsePositiveBigInt(companyId);
    const branch = parsePositiveBigInt(branchId);
    if (!company || !branch) throw new BookingBranchForbiddenError();
    const key = idempotencyKey as string;
    const fingerprint = this.fingerprint({
      operation: AGENT_OPERATION,
      company,
      branch,
      input: normalized,
    });

    return this.transactions.run(async (tx) => {
      const memberships = await this.repository.findMemberships(tx, actorUserId, company);
      const entitlements = resolveEntitlements(memberships);
      if (!canExercisePermissionInBranch(entitlements, Permission.BookingsCreate, branch)) {
        throw new BookingBranchForbiddenError();
      }
      const claim = await this.repository.claimIdempotency(
        tx,
        company,
        actorUserId,
        AGENT_OPERATION,
        key,
        fingerprint,
      );
      if (claim.kind === 'conflict') throw new IdempotencyConflictError();
      const scope = this.accessScope(entitlements, Permission.BookingsRead);
      if (claim.kind === 'replay') {
        const replay = await this.repository.findForCompany(
          tx,
          company,
          actorUserId,
          scope,
          claim.bookingId as string,
        );
        if (!replay) throw new BookingNotFoundError();
        return replay;
      }

      const trip = await this.repository.findTripForBooking(tx, normalized.tripId, company);
      if (!trip) throw new TripNotBookableError();

      return this.createClaimed(
        tx,
        trip,
        actorUserId,
        branch,
        'AGENT',
        AGENT_OPERATION,
        key,
        normalized,
      );
    });
  }

  async getOwnedBooking(actorUserId: string, bookingId: string): Promise<Booking> {
    this.assertBookingId(bookingId);
    const booking = await this.repository.findForOwner(this.db, actorUserId, bookingId);
    if (!booking) throw new BookingNotFoundError();
    return booking;
  }

  async listOwnedBookings(
    actorUserId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingPage> {
    return this.repository.listForOwner(this.db, actorUserId, pagination);
  }

  async getCompanyBooking(
    actorUserId: string,
    companyId: string,
    bookingId: string,
  ): Promise<Booking> {
    const { company, scope } = await this.companyScope(actorUserId, companyId, Permission.BookingsRead);
    this.assertBookingId(bookingId);
    const booking = await this.repository.findForCompany(
      this.db,
      company,
      actorUserId,
      scope,
      bookingId,
    );
    if (!booking) throw new BookingNotFoundError();
    return booking;
  }

  async listCompanyBookings(
    actorUserId: string,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingPage> {
    const { company, scope } = await this.companyScope(actorUserId, companyId, Permission.BookingsRead);
    return this.repository.listForCompany(this.db, company, actorUserId, scope, pagination);
  }

  async listOwnedEvents(
    actorUserId: string,
    bookingId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingEventPage> {
    this.assertBookingId(bookingId);
    const events = await this.repository.listEventsForOwner(
      this.db,
      actorUserId,
      bookingId,
      pagination,
    );
    if (!events) throw new BookingNotFoundError();
    return events;
  }

  async listCompanyEvents(
    actorUserId: string,
    companyId: string,
    bookingId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingEventPage> {
    const { company, scope } = await this.companyScope(actorUserId, companyId, Permission.BookingsRead);
    this.assertBookingId(bookingId);
    const events = await this.repository.listEventsForCompany(
      this.db,
      company,
      actorUserId,
      scope,
      bookingId,
      pagination,
    );
    if (!events) throw new BookingNotFoundError();
    return events;
  }

  async cancelOwnedBooking(actorUserId: string, bookingId: string): Promise<Booking> {
    this.assertBookingId(bookingId);
    return this.transactions.run(async (tx) => {
      const visible = await this.repository.lockOwnedBookingForCancellation(
        tx,
        actorUserId,
        bookingId,
      );
      if (!visible) throw new BookingNotFoundError();
      const cancelled = await this.repository.cancelForOwner(tx, actorUserId, bookingId);
      if (!cancelled) {
        const existing = await this.repository.findForOwner(tx, actorUserId, bookingId);
        if (existing) throw new BookingNotCancellableError();
        throw new BookingNotFoundError();
      }
      await this.repository.releaseBookingSeats(tx, bookingId);
      await this.repository.appendEvent(tx, bookingId, cancelled.companyId, actorUserId, 'CANCELLED');
      await this.audit?.append(tx, {
        actorUserId,
        companyId: cancelled.companyId,
        action: 'BOOKING_CANCELLED',
        entityType: 'booking',
        entityId: bookingId,
        newValues: { status: cancelled.status },
      });
      const booking = await this.repository.findForOwner(tx, actorUserId, bookingId);
      if (!booking) throw new BookingNotFoundError();
      return booking;
    });
  }

  async cancelCompanyBooking(
    actorUserId: string,
    companyId: string,
    bookingId: string,
  ): Promise<Booking> {
    this.assertBookingId(bookingId);
    const company = parsePositiveBigInt(companyId);
    if (!company) throw new BookingNotFoundError();
    return this.transactions.run(async (tx) => {
      const memberships = await this.repository.findMemberships(tx, actorUserId, company);
      const scope = this.accessScope(resolveEntitlements(memberships), Permission.BookingsCancel);
      const visible = await this.repository.lockCompanyBookingForCancellation(
        tx,
        company,
        scope,
        bookingId,
      );
      if (!visible) throw new BookingNotFoundError();
      const cancelled = await this.repository.cancelForCompany(
        tx,
        company,
        actorUserId,
        scope,
        bookingId,
      );
      if (!cancelled) {
        const existing = await this.repository.findForCompany(
          tx,
          company,
          actorUserId,
          scope,
          bookingId,
        );
        if (existing) throw new BookingNotCancellableError();
        throw new BookingNotFoundError();
      }
      await this.repository.releaseBookingSeats(tx, bookingId);
      await this.repository.appendEvent(tx, bookingId, company, actorUserId, 'CANCELLED');
      await this.audit?.append(tx, {
        actorUserId,
        companyId: cancelled.companyId,
        action: 'BOOKING_CANCELLED',
        entityType: 'booking',
        entityId: bookingId,
        newValues: { status: cancelled.status },
      });
      const booking = await this.repository.findForCompany(
        tx,
        company,
        actorUserId,
        scope,
        bookingId,
      );
      if (!booking) throw new BookingNotFoundError();
      return booking;
    });
  }

  async expireBookings(companyId: string): Promise<number> {
    const company = parsePositiveBigInt(companyId);
    if (!company) return 0;
    return this.transactions.run(async (tx) => {
      const expired = await this.repository.releaseExpired(tx, company);
      for (const booking of expired) {
        await this.repository.appendEvent(tx, booking.id, company, null, 'EXPIRED');
      }
      return expired.length;
    });
  }

  private async createClaimed(
    tx: Parameters<Parameters<TransactionManager['run']>[0]>[0],
    trip: Awaited<ReturnType<BookingsRepository['findTripForBooking']>> & {},
    actorUserId: string,
    branchId: string | undefined,
    channel: 'WEB' | 'AGENT',
    operation: string,
    key: string,
    input: CreateBookingInput,
  ): Promise<Booking> {
    if (!this.isTripBookable(trip)) {
      throw new TripNotBookableError();
    }

    const expired = await this.repository.releaseExpired(tx, trip.companyId, trip.tripId);
    for (const booking of expired) {
      await this.repository.appendEvent(tx, booking.id, trip.companyId, null, 'EXPIRED');
    }

    let bookingId: string | null = null;
    for (let attempt = 0; attempt < 3 && !bookingId; attempt += 1) {
      bookingId = await this.repository.insertBooking(tx, {
        companyId: trip.companyId,
        tripId: trip.tripId,
        branchId,
        actorUserId,
        bookingReference: this.references.generate(),
        bookingChannel: channel,
        passengerCount: input.passengers.length,
      });
      if (!bookingId) {
        const currentTrip = await this.repository.findTripForBooking(
          tx,
          trip.tripId,
          trip.companyId,
        );
        if (!this.isTripBookable(currentTrip)) throw new TripNotBookableError();
      }
    }
    if (!bookingId) throw new BookingReferenceUnavailableError();

    try {
      for (const passenger of input.passengers) {
        const passengerId = await this.repository.insertPassenger(tx, bookingId, passenger);
        await this.repository.insertSeat(tx, trip.tripId, bookingId, passengerId, passenger.seatId);
      }
    } catch (error) {
      if (error instanceof UniqueConstraintViolationError) throw new SeatAlreadyReservedError();
      if (error instanceof CheckConstraintViolationError) throw new InvalidSeatSelectionError();
      if (error instanceof ForeignKeyViolationError) throw new InvalidSeatSelectionError();
      throw error;
    }

    await this.repository.appendEvent(tx, bookingId, trip.companyId, actorUserId, 'BOOKING_CREATED');
    await this.repository.completeIdempotency(
      tx,
      trip.companyId,
      actorUserId,
      operation,
      key,
      bookingId,
    );
    const booking =
      channel === 'AGENT' && branchId
        ? await this.repository.findForCompany(
            tx,
            trip.companyId,
            actorUserId,
            { companyWide: false, branchIds: [branchId] },
            bookingId,
          )
        : await this.repository.findForOwner(tx, actorUserId, bookingId);
    if (!booking) throw new BookingNotFoundError();
    return booking;
  }

  private validateCreate(
    actorUserId: string,
    idempotencyKey: string | undefined,
    input: CreateBookingInput,
  ): void {
    if (!isUuid(actorUserId)) throw new BookingNotFoundError();
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new InvalidIdempotencyKeyError();
    }
    if (
      !parsePositiveBigInt(input.tripId) ||
      input.passengers.length === 0 ||
      input.passengers.length > 20
    ) {
      throw new InvalidSeatSelectionError();
    }
    if (
      input.passengers.some(
        (passenger) =>
          passenger.fullName.length < 1 ||
          passenger.fullName.length > 200 ||
          passenger.seatId.length < 1 ||
          passenger.seatId.length > 20 ||
          passenger.seatId !== passenger.seatId.trim() ||
          (passenger.phone !== undefined && !PHONE.test(passenger.phone)) ||
          (passenger.documentNumber !== undefined &&
            (passenger.documentNumber.length < 1 || passenger.documentNumber.length > 100)) ||
          !Object.values(PassengerGender).includes(
            passenger.gender ?? PassengerGender.Unspecified,
          ),
      )
    ) {
      throw new InvalidSeatSelectionError('Passenger or seat information is invalid.');
    }
    const seats = input.passengers.map((passenger) => passenger.seatId);
    if (new Set(seats).size !== seats.length) {
      throw new InvalidSeatSelectionError('A seat may be selected only once per booking.');
    }
    if (
      input.passengers.some(
        (passenger) =>
          passenger.boardingStationId !== undefined &&
          parsePositiveBigInt(passenger.boardingStationId) === null,
      )
    ) {
      throw new InvalidSeatSelectionError('The boarding station id is invalid.');
    }
  }

  private normalizeInput(input: CreateBookingInput): CreateBookingInput {
    return {
      tripId: input.tripId,
      passengers: input.passengers.map((passenger) => ({
        ...passenger,
        fullName: passenger.fullName.trim(),
        documentNumber: passenger.documentNumber?.trim(),
        gender: passenger.gender ?? PassengerGender.Unspecified,
      })),
    };
  }

  private isTripBookable(
    trip: Awaited<ReturnType<BookingsRepository['findTripForBooking']>>,
  ): boolean {
    return Boolean(
      trip?.isActive &&
        trip.status === 'SCHEDULED' &&
        new Date() < trip.boardingClosesAt,
    );
  }

  private async companyScope(
    actorUserId: string,
    companyId: string,
    permission: Permission,
  ): Promise<{ company: string; scope: BookingAccessScope }> {
    const company = parsePositiveBigInt(companyId);
    if (!company) throw new BookingNotFoundError();
    const memberships = await this.repository.findMemberships(this.db, actorUserId, company);
    return { company, scope: this.accessScope(resolveEntitlements(memberships), permission) };
  }

  private accessScope(
    entitlements: readonly Entitlement[],
    permission: Permission,
  ): BookingAccessScope {
    let companyWide = false;
    const branchIds = new Set<string>();
    for (const entitlement of entitlements) {
      if (!entitlement.permissions.includes(permission)) continue;
      if (entitlement.branchAccess.kind === 'company-wide') companyWide = true;
      if (entitlement.branchAccess.kind === 'restricted') {
        for (const branchId of entitlement.branchAccess.branchIds) branchIds.add(branchId);
      }
    }
    return { companyWide, branchIds: [...branchIds] };
  }

  private assertBookingId(bookingId: string): void {
    if (!isUuid(bookingId)) throw new BookingNotFoundError();
  }

  private fingerprint(payload: unknown): string {
    return createHash('sha256').update(this.canonicalJson(payload)).digest('hex');
  }

  private canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
      return `{${entries
        .map(([key, item]) => `${JSON.stringify(key)}:${this.canonicalJson(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  }

}
