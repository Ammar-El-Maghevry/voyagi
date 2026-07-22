import type { Membership } from '../identity/identity.types';

export enum PassengerGender {
  Male = 'MALE',
  Female = 'FEMALE',
  Unspecified = 'UNSPECIFIED',
}

export enum BookingStatus {
  Draft = 'DRAFT',
  Held = 'HELD',
  PendingPayment = 'PENDING_PAYMENT',
  Confirmed = 'CONFIRMED',
  PartiallyCancelled = 'PARTIALLY_CANCELLED',
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
  Expired = 'EXPIRED',
}

export interface BookingPassengerInput {
  readonly fullName: string;
  readonly phone?: string;
  readonly documentNumber?: string;
  readonly boardingStationId?: string;
  readonly gender?: PassengerGender;
  readonly seatId: string;
}

export interface CreateBookingInput {
  readonly tripId: string;
  readonly passengers: readonly BookingPassengerInput[];
}

export interface BookingPassenger {
  readonly id: string;
  readonly fullName: string;
  readonly phone?: string;
  readonly documentNumber?: string;
  readonly boardingStationId?: string;
  readonly gender: PassengerGender;
  readonly seatId: string;
}

export interface Booking {
  readonly id: string;
  readonly bookingReference: string;
  readonly tripId: string;
  readonly companyId: string;
  readonly branchId?: string;
  readonly bookedByUserId?: string;
  readonly bookingChannel: string;
  readonly bookingSource: string;
  readonly status: BookingStatus;
  readonly unitPrice: string;
  readonly subtotalAmount: string;
  readonly serviceFeeAmount: string;
  readonly discountAmount: string;
  readonly totalAmount: string;
  readonly currency: string;
  readonly expiresAt?: Date;
  readonly version: number;
  readonly passengers: readonly BookingPassenger[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BookingEvent {
  readonly id: string;
  readonly eventType: string;
  readonly eventTime: Date;
}

export interface BookingEventPage {
  readonly items: readonly BookingEvent[];
  readonly total: number;
}

export interface BookingTripFacts {
  readonly tripId: string;
  readonly companyId: string;
  readonly price: string;
  readonly currency: string;
  readonly status: string;
  readonly isActive: boolean;
  readonly boardingClosesAt: Date;
  readonly seatHoldMinutes: number;
  readonly cancellationPolicy: Record<string, unknown>;
}

export interface BookingAccessScope {
  readonly companyWide: boolean;
  readonly branchIds: readonly string[];
}

export interface IdempotencyClaim {
  readonly kind: 'claimed' | 'replay' | 'conflict';
  readonly bookingId?: string;
}

export interface BookingPage {
  readonly items: readonly Booking[];
  readonly total: number;
}

export interface ExpiredBooking {
  readonly id: string;
  readonly companyId: string;
}

export type BookingMembership = Membership;
