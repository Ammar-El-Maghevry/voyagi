import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import type {
  PayableBooking,
  Payment,
  PaymentAccessScope,
  PaymentIdempotencyClaim,
  PaymentMembership,
  PaymentMethod,
  PaymentPage,
  PaymentStatus,
} from './payment.types';

export const PAYMENTS_REPOSITORY = Symbol('PAYMENTS_REPOSITORY');

export interface InsertPaymentParams {
  readonly bookingId: string;
  readonly method: PaymentMethod;
  readonly internalReference: string;
}

/** A locked payment row plus the booking facts needed to scope/settle it. */
export interface LockedPayment {
  readonly id: string;
  readonly bookingId: string;
  readonly companyId: string;
  readonly branchId?: string;
  readonly bookedByUserId?: string;
  readonly bookingChannel: string;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly amount: string;
  readonly currency: string;
  readonly providerReference?: string;
  readonly internalReference: string;
}

export interface TransitionPaymentParams {
  readonly paymentId: string;
  readonly from: PaymentStatus;
  readonly to: PaymentStatus;
  readonly providerReference?: string;
  readonly confirmedByUserId?: string;
  /** When true, sets `paid_at = now()` (required for SUCCEEDED/refund states). */
  readonly setPaidAt?: boolean;
}

export interface PaymentsRepository {
  findMemberships(
    executor: DatabaseExecutor,
    actorUserId: string,
    companyId: string,
  ): Promise<PaymentMembership[]>;

  /** Booking payment facts, scoped to the passenger owner (online bookings). */
  findPayableForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<PayableBooking | null>;

  /** Booking payment facts, scoped to a company + branch entitlement. */
  findPayableForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: PaymentAccessScope,
    bookingId: string,
  ): Promise<PayableBooking | null>;

  claimIdempotency(
    executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    key: string,
    fingerprint: string,
  ): Promise<PaymentIdempotencyClaim>;

  completeIdempotency(
    executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    key: string,
    bookingId: string,
    paymentId: string,
  ): Promise<void>;

  /**
   * Insert a PENDING payment, deriving amount and currency from the booking
   * snapshot in the same statement. Returns null when no payable, unsettled
   * booking matched (or on an internal_reference collision).
   */
  insertPayment(
    executor: DatabaseExecutor,
    params: InsertPaymentParams,
  ): Promise<string | null>;

  findPaymentForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    paymentId: string,
  ): Promise<Payment | null>;

  findPaymentForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: PaymentAccessScope,
    paymentId: string,
  ): Promise<Payment | null>;

  listPaymentsForOwner(
    executor: DatabaseExecutor,
    ownerUserId: string,
    pagination: ResolvedPagination,
  ): Promise<PaymentPage>;

  listPaymentsForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: PaymentAccessScope,
    pagination: ResolvedPagination,
  ): Promise<PaymentPage>;

  /** Lock a payment for settlement, scoped to the company + branch entitlement. */
  lockPaymentForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: PaymentAccessScope,
    paymentId: string,
  ): Promise<LockedPayment | null>;

  /** Lock a payment by its internal reference (webhook path; no owner scope). */
  lockPaymentByInternalReference(
    executor: DatabaseExecutor,
    internalReference: string,
  ): Promise<LockedPayment | null>;

  /**
   * Conditionally transition a payment from an expected status. Returns the
   * updated payment, or null when the row was not in `from` (a lost race / a
   * duplicate/out-of-order event — the caller treats it idempotently).
   */
  transitionPayment(
    executor: DatabaseExecutor,
    params: TransitionPaymentParams,
  ): Promise<Payment | null>;

  /**
   * Confirm the booking a settled payment belongs to: HELD/PENDING_PAYMENT →
   * CONFIRMED and its HELD seats → CONFIRMED. Idempotent (returns false when the
   * booking was already confirmed by a concurrent settlement).
   */
  confirmBookingPaid(
    executor: DatabaseExecutor,
    bookingId: string,
  ): Promise<boolean>;

  appendBookingEvent(
    executor: DatabaseExecutor,
    bookingId: string,
    companyId: string,
    actorUserId: string | null,
    eventType: string,
  ): Promise<void>;
}
