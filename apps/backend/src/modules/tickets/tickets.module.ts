import { Module } from '@nestjs/common';
import {
  CompanyTicketsController,
  PassengerTicketsController,
} from './tickets.controller';
import { TICKETS_REPOSITORY } from './tickets.repository';
import { TicketsService } from './tickets.service';
import { PostgresTicketsRepository } from './postgres-tickets.repository';
import { TicketTokenService } from './ticket-token';
import {
  GetTicketUseCase,
  IssueTicketUseCase,
  ListTicketsUseCase,
  RevokeTicketUseCase,
  ValidateTicketUseCase,
  VerifyTicketUseCase,
} from './ticket.use-cases';

@Module({
  controllers: [PassengerTicketsController, CompanyTicketsController],
  providers: [
    { provide: TICKETS_REPOSITORY, useClass: PostgresTicketsRepository },
    TicketsService,
    TicketTokenService,
    IssueTicketUseCase,
    GetTicketUseCase,
    ListTicketsUseCase,
    ValidateTicketUseCase,
    VerifyTicketUseCase,
    RevokeTicketUseCase,
  ],
  exports: [TICKETS_REPOSITORY],
})
export class TicketsModule {}
