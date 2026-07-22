import { Module } from '@nestjs/common';
import {
  CompanyPaymentsController,
  PassengerPaymentsController,
  PaymentWebhookController,
} from './payments.controller';
import { PAYMENTS_REPOSITORY } from './payments.repository';
import { PaymentsService } from './payments.service';
import { PostgresPaymentsRepository } from './postgres-payments.repository';
import { PaymentReferenceGenerator } from './payment-reference.generator';
import { PAYMENT_PROVIDERS, type PaymentProvider } from './payment-provider.port';
import { TestPaymentProvider } from './test-payment.provider';
import {
  ConfirmPaymentUseCase,
  CreatePaymentUseCase,
  GetPaymentUseCase,
  HandlePaymentWebhookUseCase,
  ListPaymentsUseCase,
  RefundPaymentUseCase,
} from './payment.use-cases';

/**
 * Test-only shared secret for the deterministic {@link TestPaymentProvider}.
 * It is NOT a production provider credential — real provider adapters (and their
 * real secrets, sourced from configuration) are deferred until their contracts
 * are documented. Overridable via `PAYMENTS_TEST_WEBHOOK_SECRET`.
 */
const TEST_WEBHOOK_SECRET =
  process.env.PAYMENTS_TEST_WEBHOOK_SECRET ?? 'voyagi-test-webhook-secret';

@Module({
  controllers: [
    PassengerPaymentsController,
    CompanyPaymentsController,
    PaymentWebhookController,
  ],
  providers: [
    { provide: PAYMENTS_REPOSITORY, useClass: PostgresPaymentsRepository },
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (): readonly PaymentProvider[] => [
        new TestPaymentProvider(TEST_WEBHOOK_SECRET),
      ],
    },
    PaymentsService,
    PaymentReferenceGenerator,
    CreatePaymentUseCase,
    GetPaymentUseCase,
    ListPaymentsUseCase,
    ConfirmPaymentUseCase,
    RefundPaymentUseCase,
    HandlePaymentWebhookUseCase,
  ],
  exports: [PAYMENTS_REPOSITORY],
})
export class PaymentsModule {}
