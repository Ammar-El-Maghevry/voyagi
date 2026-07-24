import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommissionsModule } from '../commissions/commissions.module';
import {
  CompanyPaymentsController,
  PassengerPaymentsController,
  PaymentWebhookController,
} from './payments.controller';
import { PAYMENTS_REPOSITORY } from './payments.repository';
import { PaymentsService } from './payments.service';
import { PostgresPaymentsRepository } from './postgres-payments.repository';
import { PaymentReferenceGenerator } from './payment-reference.generator';
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
} from './payment-provider.port';
import { TestPaymentProvider } from './test-payment.provider';
import {
  resolvePaymentsProviderMode,
  resolveTestWebhookSecret,
} from './payments.provider-config';
import {
  ConfirmPaymentUseCase,
  CreatePaymentUseCase,
  GetPaymentUseCase,
  HandlePaymentWebhookUseCase,
  ListPaymentsUseCase,
  RefundPaymentUseCase,
} from './payment.use-cases';

/**
 * Registered payment-provider adapters.
 *
 * The provider mode is resolved from the environment: `disabled` (production
 * default) registers NO adapter, so every payment mutation fails safely with a
 * stable provider-unavailable error; `test` (non-production default) registers
 * ONLY the deterministic {@link TestPaymentProvider}. No real provider adapter
 * is integrated yet — production payments remain blocked until a documented
 * provider adapter and credentials are supplied in a later phase. The test
 * secret is never the built-in placeholder (see {@link resolveTestWebhookSecret}).
 */
function buildPaymentProviders(
  env: NodeJS.ProcessEnv,
): readonly PaymentProvider[] {
  const mode = resolvePaymentsProviderMode(env);
  if (mode !== 'test') return [];
  return [new TestPaymentProvider(resolveTestWebhookSecret(env))];
}

@Module({
  imports: [CommissionsModule, AuditModule],
  controllers: [
    PassengerPaymentsController,
    CompanyPaymentsController,
    PaymentWebhookController,
  ],
  providers: [
    { provide: PAYMENTS_REPOSITORY, useClass: PostgresPaymentsRepository },
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (): readonly PaymentProvider[] =>
        buildPaymentProviders(process.env),
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
