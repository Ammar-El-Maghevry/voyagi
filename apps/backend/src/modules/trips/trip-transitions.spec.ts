import { TripEventType } from './trip-event.types';
import { TripStatus } from './trip-status';
import { canApply, TripAction, TRIP_TRANSITIONS } from './trip-transitions';

describe('trip transition matrix', () => {
  it('allows start only from SCHEDULED', () => {
    expect(canApply(TripAction.Start, TripStatus.Scheduled)).toBe(true);
    for (const s of [TripStatus.Boarding, TripStatus.Ongoing, TripStatus.Completed, TripStatus.Cancelled]) {
      expect(canApply(TripAction.Start, s)).toBe(false);
    }
  });

  it('allows complete only from ONGOING', () => {
    expect(canApply(TripAction.Complete, TripStatus.Ongoing)).toBe(true);
    for (const s of [TripStatus.Scheduled, TripStatus.Boarding, TripStatus.Completed, TripStatus.Cancelled]) {
      expect(canApply(TripAction.Complete, s)).toBe(false);
    }
  });

  it('allows cancel only from SCHEDULED (BOARDING is unreachable in Phase 9)', () => {
    expect(canApply(TripAction.Cancel, TripStatus.Scheduled)).toBe(true);
    // BOARDING is never entered in Phase 9, so it is not a documented source.
    for (const s of [TripStatus.Boarding, TripStatus.Ongoing, TripStatus.Completed, TripStatus.Cancelled]) {
      expect(canApply(TripAction.Cancel, s)).toBe(false);
    }
  });

  it('maps each action to its target status, event, and stamped time', () => {
    expect(TRIP_TRANSITIONS[TripAction.Start]).toMatchObject({
      to: TripStatus.Ongoing,
      event: TripEventType.Departed,
      stamps: 'actual_departure_time',
    });
    expect(TRIP_TRANSITIONS[TripAction.Complete]).toMatchObject({
      to: TripStatus.Completed,
      event: TripEventType.Arrived,
      stamps: 'actual_arrival_time',
    });
    expect(TRIP_TRANSITIONS[TripAction.Cancel]).toMatchObject({
      to: TripStatus.Cancelled,
      event: TripEventType.Cancelled,
      stamps: null,
    });
  });
});
