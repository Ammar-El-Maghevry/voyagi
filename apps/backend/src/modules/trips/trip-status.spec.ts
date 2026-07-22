import { parseTripStatus, TripStatus } from './trip-status';

describe('parseTripStatus', () => {
  it('accepts every known status', () => {
    expect(parseTripStatus('SCHEDULED')).toBe(TripStatus.Scheduled);
    expect(parseTripStatus('BOARDING')).toBe(TripStatus.Boarding);
    expect(parseTripStatus('ONGOING')).toBe(TripStatus.Ongoing);
    expect(parseTripStatus('COMPLETED')).toBe(TripStatus.Completed);
    expect(parseTripStatus('CANCELLED')).toBe(TripStatus.Cancelled);
  });

  it('returns null for an unknown value (fail closed)', () => {
    expect(parseTripStatus('DEPARTED')).toBeNull();
    expect(parseTripStatus('')).toBeNull();
    expect(parseTripStatus('scheduled')).toBeNull();
  });
});
