import { Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import type {
  IssuedTicket,
  Ticket,
  TicketPage,
  TicketVerification,
} from './ticket.types';
import { TicketsService } from './tickets.service';

@Injectable()
export class IssueTicketUseCase {
  constructor(private readonly tickets: TicketsService) {}
  owned(actor: string, bookingId: string): Promise<IssuedTicket[]> {
    return this.tickets.issueForOwner(actor, bookingId);
  }
  company(actor: string, companyId: string, bookingId: string): Promise<IssuedTicket[]> {
    return this.tickets.issueForCompany(actor, companyId, bookingId);
  }
}

@Injectable()
export class GetTicketUseCase {
  constructor(private readonly tickets: TicketsService) {}
  owned(actor: string, ticketId: string): Promise<Ticket> {
    return this.tickets.getOwnedTicket(actor, ticketId);
  }
  company(actor: string, companyId: string, ticketId: string): Promise<Ticket> {
    return this.tickets.getCompanyTicket(actor, companyId, ticketId);
  }
}

@Injectable()
export class ListTicketsUseCase {
  constructor(private readonly tickets: TicketsService) {}
  owned(actor: string, pagination: ResolvedPagination): Promise<TicketPage> {
    return this.tickets.listOwnedTickets(actor, pagination);
  }
  company(actor: string, companyId: string, pagination: ResolvedPagination): Promise<TicketPage> {
    return this.tickets.listCompanyTickets(actor, companyId, pagination);
  }
  ownedBooking(actor: string, bookingId: string): Promise<Ticket[]> {
    return this.tickets.listOwnedBookingTickets(actor, bookingId);
  }
  companyBooking(actor: string, companyId: string, bookingId: string): Promise<Ticket[]> {
    return this.tickets.listCompanyBookingTickets(actor, companyId, bookingId);
  }
}

@Injectable()
export class ValidateTicketUseCase {
  constructor(private readonly tickets: TicketsService) {}
  execute(actor: string, companyId: string, ticketId: string): Promise<Ticket> {
    return this.tickets.validateTicket(actor, companyId, ticketId);
  }
}

@Injectable()
export class VerifyTicketUseCase {
  constructor(private readonly tickets: TicketsService) {}
  execute(actor: string, companyId: string, qrToken: string): Promise<TicketVerification> {
    return this.tickets.verifyTicket(actor, companyId, qrToken);
  }
}

@Injectable()
export class RevokeTicketUseCase {
  constructor(private readonly tickets: TicketsService) {}
  execute(actor: string, companyId: string, ticketId: string): Promise<Ticket> {
    return this.tickets.revokeTicket(actor, companyId, ticketId);
  }
}
