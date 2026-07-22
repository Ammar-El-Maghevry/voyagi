import { BookingAction, canApplyBookingAction } from './booking-transitions';
import { BookingStatus } from './booking.types';

describe('booking transitions', () => {
  it.each([BookingStatus.Held, BookingStatus.PendingPayment])(
    'allows cancellation and expiration from %s',
    (status) => {
      expect(canApplyBookingAction(status, BookingAction.Cancel)).toBe(true);
      expect(canApplyBookingAction(status, BookingAction.Expire)).toBe(true);
    },
  );

  it.each([
    BookingStatus.Draft,
    BookingStatus.Confirmed,
    BookingStatus.PartiallyCancelled,
    BookingStatus.Cancelled,
    BookingStatus.Completed,
    BookingStatus.Expired,
  ])('rejects Phase 11 cancellation and expiration from %s', (status) => {
    expect(canApplyBookingAction(status, BookingAction.Cancel)).toBe(false);
    expect(canApplyBookingAction(status, BookingAction.Expire)).toBe(false);
  });
});
