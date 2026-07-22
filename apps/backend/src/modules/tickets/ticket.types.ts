import type { Membership } from '../identity/identity.types';

/**
 * Derived ticket lifecycle. There is no ticket_status enum: the state is a pure
 * function of the issuance/terminal timestamps (`architecture/04-database-erd.md`).
 */
export enum TicketStatus {
  Issued = 'ISSUED',
  CheckedIn = 'CHECKED_IN',
  Cancelled = 'CANCELLED',
}

export function deriveTicketStatus(ticket: {
  checkedInAt?: Date;
  cancelledAt?: Date;
}): TicketStatus {
  if (ticket.cancelledAt) return TicketStatus.Cancelled;
  if (ticket.checkedInAt) return TicketStatus.CheckedIn;
  return TicketStatus.Issued;
}

/** A ticket as the domain exposes it (companyId/seat label come from joins). */
export interface Ticket {
  readonly id: string;
  readonly bookingId: string;
  readonly companyId: string;
  readonly passengerId: string;
  readonly seatReservationId: string;
  readonly seatNumber: string;
  readonly passengerName: string;
  readonly ticketNumber: string;
  readonly status: TicketStatus;
  readonly issuedAt: Date;
  readonly checkedInAt?: Date;
  readonly cancelledAt?: Date;
}

/** A freshly issued ticket, carrying the raw QR token exactly once. */
export interface IssuedTicket extends Ticket {
  /** Present only for tickets created in this issuance call; never re-derivable. */
  readonly qrToken?: string;
}

export interface TicketPage {
  readonly items: readonly Ticket[];
  readonly total: number;
}

/** A ticket plus the booking facts needed to judge live validity. */
export interface VerifiableTicket {
  readonly ticket: Ticket;
  readonly bookingStatus: string;
  readonly isPaid: boolean;
}

/** Result of verifying a presented QR token (read-only; no state change). */
export interface TicketVerification {
  readonly ticket: Ticket;
  readonly valid: boolean;
  /** Machine-readable reason when `valid` is false; omitted when valid. */
  readonly reason?: string;
}

/** Branch-coupled scope for company-scoped ticket access. */
export interface TicketAccessScope {
  readonly companyWide: boolean;
  readonly branchIds: readonly string[];
}

/** A passenger + confirmed seat that a ticket can be issued against. */
export interface IssuablePassenger {
  readonly passengerId: string;
  readonly seatReservationId: string;
}

export type TicketMembership = Membership;

/** Booking statuses in which tickets may be issued/validated. */
export const TICKETABLE_BOOKING_STATUS = 'CONFIRMED';
