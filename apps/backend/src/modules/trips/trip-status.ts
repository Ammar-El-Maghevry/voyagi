/**
 * Operational status of a trip, mirroring the database `public.trip_status_enum`.
 * A new trip is `SCHEDULED`; `COMPLETED` and `CANCELLED` are terminal.
 *
 * `BOARDING` exists in the enum but has no documented lifecycle endpoint in
 * Phase 9 (doc 18 defines start/complete/cancel only), so it is never entered
 * through the fleet-ops API here — the boarding flow belongs to the later
 * ticketing/boarding phase. An unrecognized value is dropped (fail closed).
 */
export enum TripStatus {
  Scheduled = 'SCHEDULED',
  Boarding = 'BOARDING',
  Ongoing = 'ONGOING',
  Completed = 'COMPLETED',
  Cancelled = 'CANCELLED',
}

const TRIP_STATUSES: ReadonlySet<string> = new Set(Object.values(TripStatus));

/** Parse a raw trip-status string, or `null` when it is not a known value. */
export function parseTripStatus(value: string): TripStatus | null {
  return TRIP_STATUSES.has(value) ? (value as TripStatus) : null;
}
