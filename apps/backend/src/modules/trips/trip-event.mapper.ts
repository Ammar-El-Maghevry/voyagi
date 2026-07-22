import {
  TripEventSource,
  TripEventType,
  type TripEvent,
} from './trip-event.types';

/** Raw `trip_events` row (bigint columns arrive as strings from `pg`). */
export interface TripEventRow {
  id: string;
  trip_id: string;
  company_id: string;
  actor_user_id: string | null;
  event_type: string;
  event_source: string;
  event_time: Date;
  created_at: Date;
}

/** Explicit, non-`SELECT *` column list (aligned with {@link TripEventRow}). */
export const TRIP_EVENT_COLUMNS =
  'id, trip_id, company_id, actor_user_id, event_type, event_source, event_time, created_at';

const EVENT_TYPES: ReadonlySet<string> = new Set(Object.values(TripEventType));
const EVENT_SOURCES: ReadonlySet<string> = new Set(Object.values(TripEventSource));

/**
 * Map a trip-event row to the domain type, or `null` when its type/source is not
 * a value this application version knows (fail closed — the caller excludes it).
 */
export function toTripEvent(row: TripEventRow): TripEvent | null {
  if (!EVENT_TYPES.has(row.event_type) || !EVENT_SOURCES.has(row.event_source)) {
    return null;
  }
  return {
    id: row.id,
    tripId: row.trip_id,
    companyId: row.company_id,
    actorUserId: row.actor_user_id === null ? undefined : row.actor_user_id,
    eventType: row.event_type as TripEventType,
    eventSource: row.event_source as TripEventSource,
    eventTime: row.event_time,
    createdAt: row.created_at,
  };
}
