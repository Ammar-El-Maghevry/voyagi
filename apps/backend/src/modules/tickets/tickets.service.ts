import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { DatabaseService, TransactionManager } from '../../infrastructure/database';
import { Permission } from '../authorization/permission.enum';
import { AUDIT_WRITER, type AuditWriterPort } from '../audit/audit.service';
import { resolveEntitlements, type Entitlement } from '../identity/entitlements';
import { isUuid, parsePositiveBigInt } from '../identity/identifier.util';
import {
  TicketBookingNotFoundError,
  TicketForbiddenError,
  TicketNotFoundError,
  TicketNotIssuableError,
  TicketNotValidatableError,
} from './ticket.errors';
import { TICKETS_REPOSITORY, type TicketsRepository } from './tickets.repository';
import { TicketTokenService } from './ticket-token';
import {
  type IssuedTicket,
  type Ticket,
  type TicketAccessScope,
  type TicketPage,
  type TicketVerification,
  TicketStatus,
  TICKETABLE_BOOKING_STATUS,
} from './ticket.types';

const QR_TOKEN = /^[A-Za-z0-9_-]{16,512}$/;

@Injectable()
export class TicketsService {
  constructor(
    @Inject(TICKETS_REPOSITORY) private readonly repository: TicketsRepository,
    private readonly db: DatabaseService,
    private readonly transactions: TransactionManager,
    private readonly tokens: TicketTokenService,
    @Optional() @Inject(AUDIT_WRITER) private readonly audit?: AuditWriterPort,
  ) {}

  // --- Issuance ------------------------------------------------------------

  async issueForOwner(actorUserId: string, bookingId: string): Promise<IssuedTicket[]> {
    if (!isUuid(actorUserId)) throw new TicketBookingNotFoundError();
    this.assertBookingId(bookingId);
    return this.transactions.run(async (tx) => {
      const booking = await this.repository.findBookingForOwner(tx, actorUserId, bookingId);
      if (!booking) throw new TicketBookingNotFoundError();
      return this.issue(tx, bookingId, booking.status, booking.isPaid, () =>
        this.repository.listTicketsForBookingOwner(tx, actorUserId, bookingId),
      );
    });
  }

  async issueForCompany(
    actorUserId: string,
    companyId: string,
    bookingId: string,
  ): Promise<IssuedTicket[]> {
    this.assertBookingId(bookingId);
    const { company, scope } = await this.companyScope(actorUserId, companyId, Permission.TicketsIssue);
    return this.transactions.run(async (tx) => {
      const booking = await this.repository.findBookingForCompany(tx, company, scope, bookingId);
      if (!booking) throw new TicketBookingNotFoundError();
      return this.issue(tx, bookingId, booking.status, booking.isPaid, () =>
        this.repository.listTicketsForBookingCompany(tx, company, scope, bookingId),
      );
    });
  }

  private async issue(
    tx: Parameters<Parameters<TransactionManager['run']>[0]>[0],
    bookingId: string,
    bookingStatus: string,
    isPaid: boolean,
    listAll: () => Promise<Ticket[] | null>,
  ): Promise<IssuedTicket[]> {
    if (bookingStatus !== TICKETABLE_BOOKING_STATUS) {
      throw new TicketNotIssuableError('The booking is not confirmed.');
    }
    if (!isPaid) {
      throw new TicketNotIssuableError('The booking has no successful payment.');
    }

    const issuable = await this.repository.listIssuablePassengers(tx, bookingId);
    const rawTokens = new Map<string, string>();
    for (const passenger of issuable) {
      const token = this.tokens.generateToken();
      const ticketId = await this.repository.insertTicket(tx, {
        bookingId,
        passengerId: passenger.passengerId,
        seatReservationId: passenger.seatReservationId,
        ticketNumber: this.tokens.generateTicketNumber(),
        qrTokenHash: token.hash,
      });
      if (ticketId) rawTokens.set(ticketId, token.raw);
    }

    const all = (await listAll()) ?? [];
    if (all.length === 0) {
      throw new TicketNotIssuableError('The booking has no confirmed seats to ticket.');
    }
    // The raw token is returned exactly once — only for tickets created in THIS
    // call. Pre-existing tickets (idempotent re-issue) carry no token.
    return all.map((ticket) =>
      rawTokens.has(ticket.id) ? { ...ticket, qrToken: rawTokens.get(ticket.id) } : ticket,
    );
  }

  // --- Reads ---------------------------------------------------------------

  async getOwnedTicket(actorUserId: string, ticketId: string): Promise<Ticket> {
    this.assertTicketId(ticketId);
    const ticket = await this.repository.findTicketForOwner(this.db, actorUserId, ticketId);
    if (!ticket) throw new TicketNotFoundError();
    return ticket;
  }

  async getCompanyTicket(
    actorUserId: string,
    companyId: string,
    ticketId: string,
  ): Promise<Ticket> {
    const { company, scope } = await this.companyScope(actorUserId, companyId, Permission.TicketsRead);
    this.assertTicketId(ticketId);
    const ticket = await this.repository.findTicketForCompany(this.db, company, scope, ticketId);
    if (!ticket) throw new TicketNotFoundError();
    return ticket;
  }

  async listOwnedTickets(
    actorUserId: string,
    pagination: ResolvedPagination,
  ): Promise<TicketPage> {
    return this.repository.listTicketsForOwner(this.db, actorUserId, pagination);
  }

  async listCompanyTickets(
    actorUserId: string,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<TicketPage> {
    const { company, scope } = await this.companyScope(actorUserId, companyId, Permission.TicketsRead);
    return this.repository.listTicketsForCompany(this.db, company, scope, pagination);
  }

  async listOwnedBookingTickets(actorUserId: string, bookingId: string): Promise<Ticket[]> {
    if (!isUuid(actorUserId)) throw new TicketBookingNotFoundError();
    this.assertBookingId(bookingId);
    const tickets = await this.repository.listTicketsForBookingOwner(this.db, actorUserId, bookingId);
    if (!tickets) throw new TicketBookingNotFoundError();
    return tickets;
  }

  async listCompanyBookingTickets(
    actorUserId: string,
    companyId: string,
    bookingId: string,
  ): Promise<Ticket[]> {
    this.assertBookingId(bookingId);
    const { company, scope } = await this.companyScope(actorUserId, companyId, Permission.TicketsRead);
    const tickets = await this.repository.listTicketsForBookingCompany(this.db, company, scope, bookingId);
    if (!tickets) throw new TicketBookingNotFoundError();
    return tickets;
  }

  // --- Validation / verification / revocation ------------------------------

  async validateTicket(
    actorUserId: string,
    companyId: string,
    ticketId: string,
  ): Promise<Ticket> {
    this.assertTicketId(ticketId);
    const { company, scope } = await this.companyScope(actorUserId, companyId, Permission.TicketsValidate);
    return this.transactions.run(async (tx) => {
      const locked = await this.repository.lockTicketForCompany(tx, company, scope, ticketId);
      if (!locked) throw new TicketNotFoundError();
      if (locked.cancelledAt) throw new TicketNotValidatableError('The ticket has been revoked.');
      if (locked.bookingStatus !== TICKETABLE_BOOKING_STATUS) {
        throw new TicketNotValidatableError('The booking is not confirmed.');
      }
      if (!locked.isPaid) {
        throw new TicketNotValidatableError('The booking is not settled (or was refunded).');
      }
      if (locked.checkedInAt) throw new TicketNotValidatableError('The ticket has already been used.');

      const checked = await this.repository.checkInTicket(tx, ticketId);
      if (!checked) throw new TicketNotValidatableError('The ticket has already been used.');
      await this.repository.checkInSeat(tx, locked.seatReservationId);
      await this.repository.appendBookingEvent(
        tx,
        locked.bookingId,
        locked.companyId,
        actorUserId,
        'CHECKED_IN',
      );
      await this.audit?.append(tx, {
        actorUserId,
        companyId: locked.companyId,
        action: 'TICKET_VALIDATED',
        entityType: 'ticket',
        entityId: checked.id,
        oldValues: { status: TicketStatus.Issued },
        newValues: { status: TicketStatus.CheckedIn },
      });
      return checked;
    });
  }

  async verifyTicket(
    actorUserId: string,
    companyId: string,
    qrToken: string,
  ): Promise<TicketVerification> {
    const { company, scope } = await this.companyScope(actorUserId, companyId, Permission.TicketsValidate);
    if (!QR_TOKEN.test(qrToken)) throw new TicketNotFoundError();
    const hash = this.tokens.hash(qrToken);
    const found = await this.repository.findTicketByHashForCompany(this.db, company, scope, hash);
    // Unknown/foreign token → same safe 404 as any other unreachable ticket.
    if (!found) throw new TicketNotFoundError();

    const reason = this.invalidReason(found.ticket, found.bookingStatus, found.isPaid);
    return reason
      ? { ticket: found.ticket, valid: false, reason }
      : { ticket: found.ticket, valid: true };
  }

  async revokeTicket(
    actorUserId: string,
    companyId: string,
    ticketId: string,
  ): Promise<Ticket> {
    this.assertTicketId(ticketId);
    const { company, scope } = await this.companyScope(actorUserId, companyId, Permission.TicketsIssue);
    return this.transactions.run(async (tx) => {
      const locked = await this.repository.lockTicketForCompany(tx, company, scope, ticketId);
      if (!locked) throw new TicketNotFoundError();
      if (locked.cancelledAt) throw new TicketNotValidatableError('The ticket is already revoked.');
      if (locked.checkedInAt) {
        throw new TicketNotValidatableError('A used ticket cannot be revoked.');
      }
      const revoked = await this.repository.revokeTicket(tx, ticketId);
      if (!revoked) throw new TicketNotValidatableError('The ticket cannot be revoked.');
      return revoked;
    });
  }

  // --- Helpers -------------------------------------------------------------

  private invalidReason(ticket: Ticket, bookingStatus: string, isPaid: boolean): string | undefined {
    if (ticket.status === TicketStatus.Cancelled) return 'REVOKED';
    if (ticket.status === TicketStatus.CheckedIn) return 'ALREADY_USED';
    if (bookingStatus !== TICKETABLE_BOOKING_STATUS) return 'BOOKING_NOT_CONFIRMED';
    if (!isPaid) return 'NOT_PAID';
    return undefined;
  }

  private async companyScope(
    actorUserId: string,
    companyId: string,
    permission: Permission,
  ): Promise<{ company: string; scope: TicketAccessScope }> {
    if (!isUuid(actorUserId)) throw new TicketForbiddenError();
    const company = parsePositiveBigInt(companyId);
    if (!company) throw new TicketNotFoundError();
    const memberships = await this.repository.findMemberships(this.db, actorUserId, company);
    return { company, scope: this.accessScope(resolveEntitlements(memberships), permission) };
  }

  private accessScope(
    entitlements: readonly Entitlement[],
    permission: Permission,
  ): TicketAccessScope {
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

  private assertTicketId(ticketId: string): void {
    if (!isUuid(ticketId)) throw new TicketNotFoundError();
  }

  private assertBookingId(bookingId: string): void {
    if (!isUuid(bookingId)) throw new TicketBookingNotFoundError();
  }
}
