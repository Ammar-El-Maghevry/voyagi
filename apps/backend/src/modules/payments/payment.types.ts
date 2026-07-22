import type { Membership } from '../identity/identity.types';

/** Payment tender (`public.payment_method_enum`). */
export enum PaymentMethod {
  Cash = 'CASH',
  Bankily = 'BANKILY',
  Masrvi = 'MASRVI',
  Seddad = 'SEDDAD',
  Other = 'OTHER',
}

/** Payment attempt lifecycle (`public.payment_status_enum`). */
export enum PaymentStatus {
  Pending = 'PENDING',
  Processing = 'PROCESSING',
  Succeeded = 'SUCCEEDED',
  Failed = 'FAILED',
  Cancelled = 'CANCELLED',
  PartiallyRefunded = 'PARTIALLY_REFUNDED',
  Refunded = 'REFUNDED',
}

/**
 * Methods settled through an external payment provider (as opposed to CASH,
 * which staff confirm in person). A successful provider payment requires a
 * `provider_reference`; see `public.validate_payment_booking`.
 */
export const ONLINE_METHODS: readonly PaymentMethod[] = Object.freeze([
  PaymentMethod.Bankily,
  PaymentMethod.Masrvi,
  PaymentMethod.Seddad,
]);

export function isOnlineMethod(method: PaymentMethod): boolean {
  return ONLINE_METHODS.includes(method);
}

/**
 * Immutable, server-derived facts about a booking that a payment attaches to.
 * The authoritative amount and currency come only from here — never the client.
 */
export interface PayableBooking {
  readonly bookingId: string;
  readonly companyId: string;
  readonly branchId?: string;
  readonly bookedByUserId?: string;
  readonly bookingChannel: string;
  readonly status: string;
  readonly totalAmount: string;
  readonly currency: string;
  readonly expiresAt?: Date;
}

/** A payment attempt as the domain exposes it (companyId comes from the booking join). */
export interface Payment {
  readonly id: string;
  readonly bookingId: string;
  readonly companyId: string;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly amount: string;
  readonly currency: string;
  readonly providerReference?: string;
  readonly internalReference: string;
  readonly confirmedByUserId?: string;
  readonly paidAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PaymentPage {
  readonly items: readonly Payment[];
  readonly total: number;
}

export interface CreatePaymentInput {
  readonly bookingId: string;
  readonly method: PaymentMethod;
}

/** Branch-coupled read/write scope for company-scoped payment access. */
export interface PaymentAccessScope {
  readonly companyWide: boolean;
  readonly branchIds: readonly string[];
}

export interface PaymentIdempotencyClaim {
  readonly kind: 'claimed' | 'replay' | 'conflict';
  readonly paymentId?: string;
}

export type PaymentMembership = Membership;

/** Booking statuses in which a new payment may be initiated. */
export const PAYABLE_BOOKING_STATUSES: readonly string[] = Object.freeze([
  'HELD',
  'PENDING_PAYMENT',
]);
