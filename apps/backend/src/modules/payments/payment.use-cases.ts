import { Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { CreatePaymentInput, Payment, PaymentPage } from './payment.types';
import { PaymentsService } from './payments.service';

@Injectable()
export class CreatePaymentUseCase {
  constructor(private readonly payments: PaymentsService) {}
  passenger(actor: string, key: string | undefined, input: CreatePaymentInput): Promise<Payment> {
    return this.payments.createPassengerPayment(actor, key, input);
  }
  company(
    actor: string,
    companyId: string,
    key: string | undefined,
    input: CreatePaymentInput,
  ): Promise<Payment> {
    return this.payments.createCompanyPayment(actor, companyId, key, input);
  }
}

@Injectable()
export class GetPaymentUseCase {
  constructor(private readonly payments: PaymentsService) {}
  owned(actor: string, paymentId: string): Promise<Payment> {
    return this.payments.getOwnedPayment(actor, paymentId);
  }
  company(actor: string, companyId: string, paymentId: string): Promise<Payment> {
    return this.payments.getCompanyPayment(actor, companyId, paymentId);
  }
}

@Injectable()
export class ListPaymentsUseCase {
  constructor(private readonly payments: PaymentsService) {}
  owned(actor: string, pagination: ResolvedPagination): Promise<PaymentPage> {
    return this.payments.listOwnedPayments(actor, pagination);
  }
  company(actor: string, companyId: string, pagination: ResolvedPagination): Promise<PaymentPage> {
    return this.payments.listCompanyPayments(actor, companyId, pagination);
  }
}

@Injectable()
export class ConfirmPaymentUseCase {
  constructor(private readonly payments: PaymentsService) {}
  execute(actor: string, companyId: string, paymentId: string): Promise<Payment> {
    return this.payments.confirmCashPayment(actor, companyId, paymentId);
  }
}

@Injectable()
export class RefundPaymentUseCase {
  constructor(private readonly payments: PaymentsService) {}
  execute(actor: string, companyId: string, paymentId: string): Promise<Payment> {
    return this.payments.refundPayment(actor, companyId, paymentId);
  }
}

@Injectable()
export class HandlePaymentWebhookUseCase {
  constructor(private readonly payments: PaymentsService) {}
  execute(
    provider: string,
    rawBody: Buffer,
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ): Promise<{ received: true }> {
    return this.payments.handleWebhook(provider, rawBody, headers);
  }
}
