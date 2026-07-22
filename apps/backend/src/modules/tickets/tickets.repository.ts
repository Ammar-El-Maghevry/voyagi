import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import type {
  IssuablePassenger,
  Ticket,
  TicketAccessScope,
  TicketMembership,
  TicketPage,
  VerifiableTicket,
} from './ticket.types';

export const TICKETS_REPOSITORY = Symbol('TICKETS_REPOSITORY');

/** Booking facts governing ticket issuance/validation. */
export interface TicketableBooking {
  readonly bookingId: string;
  readonly companyId: string;
  readonly branchId?: string;
  readonly bookedByUserId?: string;
  readonly bookingChannel: string;
  readonly status: string;
  /** Whether a SUCCEEDED (non-refunded) payment settles this booking. */
  readonly isPaid: boolean;
}

/** A locked ticket plus the booking/payment facts needed to validate it. */
export interface LockedTicket {
  readonly id: string;
  readonly bookingId: string;
  readonly companyId: string;
  readonly seatReservationId: string;
  readonly bookingStatus: string;
  readonly isPaid: boolean;
  readonly checkedInAt?: Date;
  readonly cancelledAt?: Date;
}

export interface InsertTicketParams {
  readonly bookingId: string;
  readonly passengerId: string;
  readonly seatReservationId: string;
  readonly ticketNumber: string;
  readonly qrTokenHash: string;
}

export interface TicketsRepository {
  findMemberships(
    executor: DatabaseExecutor,
    actorUserId: string,
    companyId: string,
  ): Promise<TicketMembership[]>;

  findBookingForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<TicketableBooking | null>;

  findBookingForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: TicketAccessScope,
    bookingId: string,
  ): Promise<TicketableBooking | null>;

  /** Passengers with a CONFIRMED seat and no ticket yet, for a booking. */
  listIssuablePassengers(
    executor: DatabaseExecutor,
    bookingId: string,
  ): Promise<IssuablePassenger[]>;

  /** Insert one ticket; returns its id, or null when the passenger/seat already has one. */
  insertTicket(
    executor: DatabaseExecutor,
    params: InsertTicketParams,
  ): Promise<string | null>;

  findTicketById(
    executor: DatabaseExecutor,
    ticketId: string,
  ): Promise<Ticket | null>;

  listTicketsForBookingOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<Ticket[] | null>;

  listTicketsForBookingCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: TicketAccessScope,
    bookingId: string,
  ): Promise<Ticket[] | null>;

  findTicketForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    ticketId: string,
  ): Promise<Ticket | null>;

  findTicketForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: TicketAccessScope,
    ticketId: string,
  ): Promise<Ticket | null>;

  listTicketsForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    pagination: ResolvedPagination,
  ): Promise<TicketPage>;

  listTicketsForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: TicketAccessScope,
    pagination: ResolvedPagination,
  ): Promise<TicketPage>;

  /** Find a ticket (+ live booking state) by its QR-token hash, company-scoped. */
  findTicketByHashForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: TicketAccessScope,
    qrTokenHash: string,
  ): Promise<VerifiableTicket | null>;

  /** Lock a ticket for validation, scoped to a company entitlement. */
  lockTicketForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: TicketAccessScope,
    ticketId: string,
  ): Promise<LockedTicket | null>;

  /** Set `checked_in_at = now()` when still ISSUED. Returns null on a lost race. */
  checkInTicket(
    executor: DatabaseExecutor,
    ticketId: string,
  ): Promise<Ticket | null>;

  /** Set `cancelled_at = now()` when still ISSUED (revoke). Returns null on a lost race. */
  revokeTicket(
    executor: DatabaseExecutor,
    ticketId: string,
  ): Promise<Ticket | null>;

  /** Move a CONFIRMED seat reservation to CHECKED_IN (boarding). */
  checkInSeat(
    executor: DatabaseExecutor,
    seatReservationId: string,
  ): Promise<void>;

  appendBookingEvent(
    executor: DatabaseExecutor,
    bookingId: string,
    companyId: string,
    actorUserId: string | null,
    eventType: string,
  ): Promise<void>;
}
