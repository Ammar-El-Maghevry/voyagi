import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import type {
  Booking,
  BookingAccessScope,
  BookingEventPage,
  BookingMembership,
  BookingPage,
  BookingPassengerInput,
  BookingStatus,
  BookingTripFacts,
  ExpiredBooking,
  IdempotencyClaim,
} from './booking.types';

export const BOOKINGS_REPOSITORY = Symbol('BOOKINGS_REPOSITORY');

export interface InsertBookingParams {
  readonly companyId: string;
  readonly tripId: string;
  readonly branchId?: string;
  readonly actorUserId: string;
  readonly bookingReference: string;
  readonly bookingChannel: 'WEB' | 'AGENT';
  readonly passengerCount: number;
}

export interface BookingsRepository {
  findTripCompany(
    executor: DatabaseExecutor,
    tripId: string,
    companyId?: string,
  ): Promise<string | null>;
  findTripForBooking(
    executor: DatabaseExecutor,
    tripId: string,
    companyId?: string,
  ): Promise<BookingTripFacts | null>;
  findMemberships(
    executor: DatabaseExecutor,
    actorUserId: string,
    companyId: string,
  ): Promise<BookingMembership[]>;
  releaseExpired(
    executor: DatabaseExecutor,
    companyId: string,
    tripId?: string,
  ): Promise<ExpiredBooking[]>;
  claimIdempotency(
    executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    operation: string,
    key: string,
    fingerprint: string,
  ): Promise<IdempotencyClaim>;
  completeIdempotency(
    executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    operation: string,
    key: string,
    bookingId: string,
  ): Promise<void>;
  insertBooking(executor: DatabaseExecutor, params: InsertBookingParams): Promise<string | null>;
  insertPassenger(
    executor: DatabaseExecutor,
    bookingId: string,
    passenger: BookingPassengerInput,
  ): Promise<string>;
  insertSeat(
    executor: DatabaseExecutor,
    tripId: string,
    bookingId: string,
    passengerId: string,
    seatId: string,
  ): Promise<void>;
  appendEvent(
    executor: DatabaseExecutor,
    bookingId: string,
    companyId: string,
    actorUserId: string | null,
    eventType: string,
  ): Promise<void>;
  findForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<Booking | null>;
  findForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    scope: BookingAccessScope,
    bookingId: string,
  ): Promise<Booking | null>;
  listForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingPage>;
  listForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    scope: BookingAccessScope,
    pagination: ResolvedPagination,
  ): Promise<BookingPage>;
  listEventsForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingEventPage | null>;
  listEventsForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    scope: BookingAccessScope,
    bookingId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingEventPage | null>;
  lockOwnedBookingForCancellation(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<boolean>;
  lockCompanyBookingForCancellation(
    executor: DatabaseExecutor,
    companyId: string,
    scope: BookingAccessScope,
    bookingId: string,
  ): Promise<boolean>;
  cancelForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<{ companyId: string; status: BookingStatus } | null>;
  cancelForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    scope: BookingAccessScope,
    bookingId: string,
  ): Promise<{ companyId: string; status: BookingStatus } | null>;
  releaseBookingSeats(executor: DatabaseExecutor, bookingId: string): Promise<void>;
}
