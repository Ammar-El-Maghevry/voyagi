import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import {
  DatabaseService,
  TransactionManager,
  UniqueConstraintViolationError,
} from '../../infrastructure/database';
import { Permission } from '../authorization/permission.enum';
import { resolveEntitlements, type Entitlement } from '../identity/entitlements';
import { isUuid, parsePositiveBigInt } from '../identity/identifier.util';
import {
  BookingNotPayableError,
  InvalidIdempotencyKeyError,
  PaymentAlreadySettledError,
  PaymentBookingNotFoundError,
  PaymentForbiddenError,
  PaymentIdempotencyConflictError,
  PaymentMethodNotAllowedError,
  PaymentNotConfirmableError,
  PaymentNotFoundError,
  PaymentNotRefundableError,
  PaymentReferenceUnavailableError,
} from './payment.errors';
import { PaymentReferenceGenerator } from './payment-reference.generator';
import {
  PAYMENT_PROVIDERS,
  ProviderEventOutcome,
  type PaymentProvider,
} from './payment-provider.port';
import {
  PAYMENTS_REPOSITORY,
  type LockedPayment,
  type PaymentsRepository,
} from './payments.repository';
import {
  type CreatePaymentInput,
  isOnlineMethod,
  type PayableBooking,
  type Payment,
  type PaymentAccessScope,
  PaymentMethod,
  type PaymentPage,
  PaymentStatus,
  PAYABLE_BOOKING_STATUSES,
} from './payment.types';
import { canTransitionPayment } from './payment-transitions';

const IDEMPOTENCY_KEY = /^[\x21-\x7E]{1,255}$/;
const CREATE_OPERATION = 'CREATE_PAYMENT';
const REFERENCE_ATTEMPTS = 3;

@Injectable()
export class PaymentsService {
  private readonly providers: readonly PaymentProvider[];

  constructor(
    @Inject(PAYMENTS_REPOSITORY) private readonly repository: PaymentsRepository,
    private readonly db: DatabaseService,
    private readonly transactions: TransactionManager,
    private readonly references: PaymentReferenceGenerator,
    @Inject(PAYMENT_PROVIDERS) providers: readonly PaymentProvider[],
  ) {
    this.providers = providers;
  }

  // --- Creation ------------------------------------------------------------

  async createPassengerPayment(
    actorUserId: string,
    idempotencyKey: string | undefined,
    input: CreatePaymentInput,
  ): Promise<Payment> {
    this.validateCreate(actorUserId, idempotencyKey, input);
    // Passengers settle online; CASH is confirmed in person by staff.
    if (!isOnlineMethod(input.method)) {
      throw new PaymentMethodNotAllowedError(
        'Passengers can only pay with an online method.',
      );
    }
    const key = idempotencyKey as string;
    const fingerprint = this.fingerprint({
      operation: CREATE_OPERATION,
      actor: actorUserId,
      bookingId: input.bookingId,
      method: input.method,
    });

    return this.transactions.run(async (tx) => {
      const booking = await this.repository.findPayableForOwner(
        tx,
        actorUserId,
        input.bookingId,
      );
      if (!booking) throw new PaymentBookingNotFoundError();
      return this.createClaimed(tx, booking, actorUserId, key, fingerprint, input, 'owner');
    });
  }

  async createCompanyPayment(
    actorUserId: string,
    companyId: string,
    idempotencyKey: string | undefined,
    input: CreatePaymentInput,
  ): Promise<Payment> {
    this.validateCreate(actorUserId, idempotencyKey, input);
    const key = idempotencyKey as string;
    const { company, scope } = await this.companyScope(
      actorUserId,
      companyId,
      Permission.PaymentsConfirm,
    );
    const fingerprint = this.fingerprint({
      operation: CREATE_OPERATION,
      actor: actorUserId,
      company,
      bookingId: input.bookingId,
      method: input.method,
    });

    return this.transactions.run(async (tx) => {
      const booking = await this.repository.findPayableForCompany(
        tx,
        company,
        scope,
        input.bookingId,
      );
      if (!booking) throw new PaymentBookingNotFoundError();
      return this.createClaimed(tx, booking, actorUserId, key, fingerprint, input, 'company');
    });
  }

  private async createClaimed(
    tx: Parameters<Parameters<TransactionManager['run']>[0]>[0],
    booking: PayableBooking,
    actorUserId: string,
    key: string,
    fingerprint: string,
    input: CreatePaymentInput,
    scope: 'owner' | 'company',
  ): Promise<Payment> {
    const claim = await this.repository.claimIdempotency(
      tx,
      booking.companyId,
      actorUserId,
      key,
      fingerprint,
    );
    if (claim.kind === 'conflict') throw new PaymentIdempotencyConflictError();
    if (claim.kind === 'replay') {
      const replay = await this.loadPayment(tx, booking, actorUserId, claim.paymentId as string, scope);
      if (!replay) throw new PaymentNotFoundError();
      return replay;
    }

    if (!this.isBookingPayable(booking)) {
      throw new BookingNotPayableError(
        booking.expiresAt && booking.expiresAt <= new Date()
          ? 'The booking hold has expired.'
          : 'The booking is not open for payment.',
      );
    }

    let paymentId: string | null = null;
    let internalReference = '';
    for (let attempt = 0; attempt < REFERENCE_ATTEMPTS && !paymentId; attempt += 1) {
      const reference = this.references.generate();
      paymentId = await this.repository.insertPayment(tx, {
        bookingId: booking.bookingId,
        method: input.method,
        internalReference: reference,
      });
      if (paymentId) internalReference = reference;
    }
    // A payable, locked booking cannot already be settled (a success confirms
    // it), so a persistent null is only an internal_reference collision.
    if (!paymentId) throw new PaymentReferenceUnavailableError();

    await this.repository.appendBookingEvent(
      tx,
      booking.bookingId,
      booking.companyId,
      actorUserId,
      'PAYMENT_PENDING',
    );

    // Online methods open a provider settlement and advance to PROCESSING. The
    // only wired adapter is the deterministic in-process test provider, so the
    // call is safe inside this transaction. A real (network) provider adapter
    // MUST instead use a durable two-phase workflow so the transaction is never
    // held open across a network round-trip.
    if (isOnlineMethod(input.method)) {
      const provider = this.providerForMethod(input.method);
      const initiation = await provider.initiate({
        method: input.method,
        internalReference,
        amount: booking.totalAmount,
        currency: booking.currency,
      });
      await this.repository.transitionPayment(tx, {
        paymentId,
        from: PaymentStatus.Pending,
        to: PaymentStatus.Processing,
        providerReference: initiation.providerReference,
      });
    }

    await this.repository.completeIdempotency(
      tx,
      booking.companyId,
      actorUserId,
      key,
      booking.bookingId,
      paymentId,
    );

    const payment = await this.loadPayment(tx, booking, actorUserId, paymentId, scope);
    if (!payment) throw new PaymentNotFoundError();
    return payment;
  }

  // --- Reads ---------------------------------------------------------------

  async getOwnedPayment(actorUserId: string, paymentId: string): Promise<Payment> {
    this.assertPaymentId(paymentId);
    const payment = await this.repository.findPaymentForOwner(this.db, actorUserId, paymentId);
    if (!payment) throw new PaymentNotFoundError();
    return payment;
  }

  async listOwnedPayments(
    actorUserId: string,
    pagination: ResolvedPagination,
  ): Promise<PaymentPage> {
    return this.repository.listPaymentsForOwner(this.db, actorUserId, pagination);
  }

  async getCompanyPayment(
    actorUserId: string,
    companyId: string,
    paymentId: string,
  ): Promise<Payment> {
    const { company, scope } = await this.companyScope(actorUserId, companyId, Permission.PaymentsRead);
    this.assertPaymentId(paymentId);
    const payment = await this.repository.findPaymentForCompany(this.db, company, scope, paymentId);
    if (!payment) throw new PaymentNotFoundError();
    return payment;
  }

  async listCompanyPayments(
    actorUserId: string,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PaymentPage> {
    const { company, scope } = await this.companyScope(actorUserId, companyId, Permission.PaymentsRead);
    return this.repository.listPaymentsForCompany(this.db, company, scope, pagination);
  }

  // --- Confirmation / refund ----------------------------------------------

  async confirmCashPayment(
    actorUserId: string,
    companyId: string,
    paymentId: string,
  ): Promise<Payment> {
    this.assertPaymentId(paymentId);
    const { company, scope } = await this.companyScope(actorUserId, companyId, Permission.PaymentsConfirm);
    return this.transactions.run(async (tx) => {
      const locked = await this.repository.lockPaymentForCompany(tx, company, scope, paymentId);
      if (!locked) throw new PaymentNotFoundError();
      if (locked.method !== PaymentMethod.Cash) {
        throw new PaymentMethodNotAllowedError('Only cash payments are confirmed manually.');
      }
      if (locked.status !== PaymentStatus.Pending) throw new PaymentNotConfirmableError();

      const succeeded = await this.settle(tx, locked, PaymentStatus.Pending, actorUserId);
      return succeeded;
    });
  }

  async refundPayment(
    actorUserId: string,
    companyId: string,
    paymentId: string,
  ): Promise<Payment> {
    this.assertPaymentId(paymentId);
    const { company, scope } = await this.companyScope(actorUserId, companyId, Permission.PaymentsRefund);
    return this.transactions.run(async (tx) => {
      const locked = await this.repository.lockPaymentForCompany(tx, company, scope, paymentId);
      if (!locked) throw new PaymentNotFoundError();
      // Full refund only: SUCCEEDED -> REFUNDED. Partial-refund amounts have no
      // schema home, so they are deferred (see README).
      if (locked.status !== PaymentStatus.Succeeded) throw new PaymentNotRefundableError();

      const refunded = await this.repository.transitionPayment(tx, {
        paymentId: locked.id,
        from: PaymentStatus.Succeeded,
        to: PaymentStatus.Refunded,
      });
      if (!refunded) throw new PaymentNotRefundableError();
      await this.repository.appendBookingEvent(
        tx,
        locked.bookingId,
        locked.companyId,
        actorUserId,
        'REFUND_CREATED',
      );
      await this.repository.appendBookingEvent(
        tx,
        locked.bookingId,
        locked.companyId,
        actorUserId,
        'REFUND_COMPLETED',
      );
      return refunded;
    });
  }

  // --- Webhook -------------------------------------------------------------

  async handleWebhook(
    providerName: string,
    rawBody: Buffer,
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ): Promise<{ received: true }> {
    const provider = this.providers.find((candidate) => candidate.name === providerName);
    if (!provider) throw new PaymentNotFoundError();

    // Verify signature and parse BEFORE any state is read or mutated.
    const event = provider.verifyAndParse({ rawBody, headers });

    await this.transactions.run(async (tx) => {
      const locked = await this.repository.lockPaymentByInternalReference(
        tx,
        event.internalReference,
      );
      if (!locked) throw new PaymentNotFoundError();
      if (!provider.handlesMethod(locked.method)) throw new PaymentNotFoundError();

      // The event must map to this exact payment: matching provider reference
      // (when already stored) and the booking-snapshot amount and currency. A
      // mismatch never mutates state and never marks a payment successful.
      if (
        (locked.providerReference && locked.providerReference !== event.providerReference) ||
        event.amount !== locked.amount ||
        event.currency !== locked.currency
      ) {
        throw new PaymentMethodNotAllowedError('The webhook does not match the payment.');
      }

      // Duplicate / out-of-order delivery: a terminal payment is a no-op.
      const target =
        event.outcome === ProviderEventOutcome.Succeeded
          ? PaymentStatus.Succeeded
          : PaymentStatus.Failed;
      if (!canTransitionPayment(locked.status, target)) {
        return; // idempotent acknowledgement
      }

      if (target === PaymentStatus.Succeeded) {
        await this.settle(tx, locked, locked.status, null, event.providerReference);
      } else {
        await this.repository.transitionPayment(tx, {
          paymentId: locked.id,
          from: locked.status,
          to: PaymentStatus.Failed,
          providerReference: event.providerReference,
        });
      }
    });

    return { received: true };
  }

  /**
   * Drive a payment to SUCCEEDED from `from`, confirm the booking exactly once,
   * and write the PAYMENT_CONFIRMED event. The partial unique index
   * `uq_successful_payment_per_booking` turns a concurrent second settlement
   * into a unique violation, which surfaces as a safe "already settled" 409.
   */
  private async settle(
    tx: Parameters<Parameters<TransactionManager['run']>[0]>[0],
    locked: LockedPayment,
    from: PaymentStatus,
    actorUserId: string | null,
    providerReference?: string,
  ): Promise<Payment> {
    let succeeded: Payment | null;
    try {
      succeeded = await this.repository.transitionPayment(tx, {
        paymentId: locked.id,
        from,
        to: PaymentStatus.Succeeded,
        providerReference,
        confirmedByUserId: actorUserId ?? undefined,
        setPaidAt: true,
      });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationError) {
        throw new PaymentAlreadySettledError();
      }
      throw error;
    }
    if (!succeeded) throw new PaymentNotConfirmableError();

    await this.repository.confirmBookingPaid(tx, locked.bookingId);
    await this.repository.appendBookingEvent(
      tx,
      locked.bookingId,
      locked.companyId,
      actorUserId,
      'PAYMENT_CONFIRMED',
    );
    return succeeded;
  }

  // --- Helpers -------------------------------------------------------------

  private async loadPayment(
    tx: Parameters<Parameters<TransactionManager['run']>[0]>[0],
    booking: PayableBooking,
    actorUserId: string,
    paymentId: string,
    scope: 'owner' | 'company',
  ): Promise<Payment | null> {
    return scope === 'owner'
      ? this.repository.findPaymentForOwner(tx, actorUserId, paymentId)
      : this.repository.findPaymentForCompany(
          tx,
          booking.companyId,
          { companyWide: true, branchIds: [] },
          paymentId,
        );
  }

  private validateCreate(
    actorUserId: string,
    idempotencyKey: string | undefined,
    input: CreatePaymentInput,
  ): void {
    if (!isUuid(actorUserId)) throw new PaymentBookingNotFoundError();
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new InvalidIdempotencyKeyError();
    }
    if (!isUuid(input.bookingId)) throw new PaymentBookingNotFoundError();
    if (!Object.values(PaymentMethod).includes(input.method)) {
      throw new PaymentMethodNotAllowedError();
    }
  }

  private isBookingPayable(booking: PayableBooking): boolean {
    return (
      PAYABLE_BOOKING_STATUSES.includes(booking.status) &&
      (!booking.expiresAt || booking.expiresAt > new Date())
    );
  }

  private providerForMethod(method: PaymentMethod): PaymentProvider {
    const provider = this.providers.find((candidate) => candidate.handlesMethod(method));
    if (!provider) throw new PaymentMethodNotAllowedError('No provider is configured for this method.');
    return provider;
  }

  private async companyScope(
    actorUserId: string,
    companyId: string,
    permission: Permission,
  ): Promise<{ company: string; scope: PaymentAccessScope }> {
    if (!isUuid(actorUserId)) throw new PaymentForbiddenError();
    const company = parsePositiveBigInt(companyId);
    if (!company) throw new PaymentNotFoundError();
    const memberships = await this.repository.findMemberships(this.db, actorUserId, company);
    return { company, scope: this.accessScope(resolveEntitlements(memberships), permission) };
  }

  private accessScope(
    entitlements: readonly Entitlement[],
    permission: Permission,
  ): PaymentAccessScope {
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

  private assertPaymentId(paymentId: string): void {
    if (!isUuid(paymentId)) throw new PaymentNotFoundError();
  }

  private fingerprint(payload: unknown): string {
    return createHash('sha256').update(this.canonicalJson(payload)).digest('hex');
  }

  private canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
      return `{${entries
        .map(([key, item]) => `${JSON.stringify(key)}:${this.canonicalJson(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  }
}
