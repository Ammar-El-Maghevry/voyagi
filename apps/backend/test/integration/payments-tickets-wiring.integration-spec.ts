import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { BookingsService } from '../../src/modules/bookings/bookings.service';
import { BOOKINGS_REPOSITORY } from '../../src/modules/bookings/bookings.repository';
import { AvailabilityService } from '../../src/modules/availability/availability.service';
import {
  CompanyPaymentsController,
  PassengerPaymentsController,
  PaymentWebhookController,
} from '../../src/modules/payments/payments.controller';
import { PAYMENTS_REPOSITORY } from '../../src/modules/payments/payments.repository';
import { PostgresPaymentsRepository } from '../../src/modules/payments/postgres-payments.repository';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
} from '../../src/modules/payments/payment-provider.port';
import { TestPaymentProvider } from '../../src/modules/payments/test-payment.provider';
import {
  ConfirmPaymentUseCase,
  CreatePaymentUseCase,
  HandlePaymentWebhookUseCase,
  RefundPaymentUseCase,
} from '../../src/modules/payments/payment.use-cases';
import {
  CompanyTicketsController,
  PassengerTicketsController,
} from '../../src/modules/tickets/tickets.controller';
import { TICKETS_REPOSITORY } from '../../src/modules/tickets/tickets.repository';
import { PostgresTicketsRepository } from '../../src/modules/tickets/postgres-tickets.repository';
import { TicketsService } from '../../src/modules/tickets/tickets.service';
import {
  IssueTicketUseCase,
  ValidateTicketUseCase,
  VerifyTicketUseCase,
} from '../../src/modules/tickets/ticket.use-cases';

describe('Payments & Tickets module wiring (integration)', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
  });

  it('resolves payment and ticket providers against the real AppModule', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const opts = { strict: false } as const;

    // Controllers.
    expect(moduleRef.get(PassengerPaymentsController, opts)).toBeInstanceOf(PassengerPaymentsController);
    expect(moduleRef.get(CompanyPaymentsController, opts)).toBeInstanceOf(CompanyPaymentsController);
    expect(moduleRef.get(PaymentWebhookController, opts)).toBeInstanceOf(PaymentWebhookController);
    expect(moduleRef.get(PassengerTicketsController, opts)).toBeInstanceOf(PassengerTicketsController);
    expect(moduleRef.get(CompanyTicketsController, opts)).toBeInstanceOf(CompanyTicketsController);

    // Services + use cases.
    expect(moduleRef.get(PaymentsService, opts)).toBeInstanceOf(PaymentsService);
    expect(moduleRef.get(TicketsService, opts)).toBeInstanceOf(TicketsService);
    for (const useCase of [
      CreatePaymentUseCase,
      ConfirmPaymentUseCase,
      RefundPaymentUseCase,
      HandlePaymentWebhookUseCase,
      IssueTicketUseCase,
      ValidateTicketUseCase,
      VerifyTicketUseCase,
    ]) {
      expect(moduleRef.get(useCase, opts)).toBeInstanceOf(useCase);
    }

    // Repository ports resolve to their PostgreSQL adapters.
    expect(moduleRef.get(PAYMENTS_REPOSITORY, opts)).toBeInstanceOf(PostgresPaymentsRepository);
    expect(moduleRef.get(TICKETS_REPOSITORY, opts)).toBeInstanceOf(PostgresTicketsRepository);

    // Provider port resolves ONLY the documented test adapter — no invented vendor.
    const providers = moduleRef.get<readonly PaymentProvider[]>(PAYMENT_PROVIDERS, opts);
    expect(Array.isArray(providers)).toBe(true);
    expect(providers).toHaveLength(1);
    expect(providers[0]).toBeInstanceOf(TestPaymentProvider);
    expect(providers.map((p) => p.name)).toEqual(['test']);

    // Phase 10/11 modules remain resolvable.
    expect(moduleRef.get(BookingsService, opts)).toBeInstanceOf(BookingsService);
    expect(moduleRef.get(AvailabilityService, opts)).toBeInstanceOf(AvailabilityService);
    expect(moduleRef.get(BOOKINGS_REPOSITORY, opts)).toBeDefined();

    // No Phase 14+ provider was introduced.
    const forbidden = [
      'MaintenanceService',
      'CommissionService',
      'AgentCommissionService',
      'NotificationService',
      'AuditService',
    ];
    for (const name of forbidden) {
      // An unknown token makes Nest throw — proving the provider was never wired.
      expect(() => moduleRef.get(name, opts)).toThrow();
    }

    await moduleRef.close();
  });
});
