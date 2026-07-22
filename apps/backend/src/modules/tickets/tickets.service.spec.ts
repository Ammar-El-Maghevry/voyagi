import type { DatabaseService, TransactionManager } from '../../infrastructure/database';
import type { Transaction } from '../../infrastructure/database/transaction.manager';
import type { AuditWriterPort } from '../audit/audit.service';
import { MembershipRole } from '../identity/membership-role';
import type { TicketsRepository } from './tickets.repository';
import { TicketsService } from './tickets.service';
import { TicketStatus, type Ticket } from './ticket.types';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const TICKET_ID = '22222222-2222-4222-8222-222222222222';
const BOOKING_ID = '33333333-3333-4333-8333-333333333333';
const SEAT_RESERVATION_ID = '44444444-4444-4444-8444-444444444444';
const COMPANY_ID = '10';

describe('TicketsService', () => {
  it('audits a successful validation using status-only metadata', async () => {
    const tx = {} as Transaction;
    const transactions = {
      run: <T>(work: (transaction: Transaction) => Promise<T>): Promise<T> => work(tx),
    } as unknown as TransactionManager;
    const checked: Ticket = {
      id: TICKET_ID,
      bookingId: BOOKING_ID,
      companyId: COMPANY_ID,
      passengerId: '55555555-5555-4555-8555-555555555555',
      seatReservationId: SEAT_RESERVATION_ID,
      seatNumber: '1A',
      passengerName: 'Passenger Name',
      ticketNumber: 'TKT-1',
      status: TicketStatus.CheckedIn,
      issuedAt: new Date('2026-07-22T00:00:00.000Z'),
      checkedInAt: new Date('2026-07-22T01:00:00.000Z'),
    };
    const repository = {
      findMemberships: jest.fn().mockResolvedValue([
        {
          id: '1',
          userId: ACTOR,
          companyId: COMPANY_ID,
          role: MembershipRole.CompanyManager,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
      lockTicketForCompany: jest.fn().mockResolvedValue({
        id: TICKET_ID,
        bookingId: BOOKING_ID,
        companyId: COMPANY_ID,
        seatReservationId: SEAT_RESERVATION_ID,
        bookingStatus: 'CONFIRMED',
        isPaid: true,
      }),
      checkInTicket: jest.fn().mockResolvedValue(checked),
      checkInSeat: jest.fn().mockResolvedValue(undefined),
      appendBookingEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as TicketsRepository;
    const audit = { append: jest.fn().mockResolvedValue({}) } as unknown as AuditWriterPort;
    const service = new TicketsService(
      repository,
      {} as DatabaseService,
      transactions,
      {} as never,
      audit,
    );

    await expect(service.validateTicket(ACTOR, COMPANY_ID, TICKET_ID)).resolves.toBe(checked);

    expect(audit.append).toHaveBeenCalledWith(tx, {
      actorUserId: ACTOR,
      companyId: COMPANY_ID,
      action: 'TICKET_VALIDATED',
      entityType: 'ticket',
      entityId: TICKET_ID,
      oldValues: { status: TicketStatus.Issued },
      newValues: { status: TicketStatus.CheckedIn },
    });
  });
});
