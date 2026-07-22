import { BookingStatus } from './booking.types';

export enum BookingAction {
  Cancel = 'CANCEL',
  Expire = 'EXPIRE',
}

export const BOOKING_TRANSITIONS = Object.freeze({
  [BookingAction.Cancel]: {
    from: [BookingStatus.Held, BookingStatus.PendingPayment] as const,
    to: BookingStatus.Cancelled,
  },
  [BookingAction.Expire]: {
    from: [BookingStatus.Held, BookingStatus.PendingPayment] as const,
    to: BookingStatus.Expired,
  },
});

export function canApplyBookingAction(
  status: BookingStatus,
  action: BookingAction,
): boolean {
  return (BOOKING_TRANSITIONS[action].from as readonly BookingStatus[]).includes(
    status,
  );
}
