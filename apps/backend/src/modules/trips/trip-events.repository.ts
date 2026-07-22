import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import type { PagedResult } from './trips.repository';
import type { TripEvent, TripEventCreate } from './trip-event.types';

/** DI token bound to the concrete {@link TripEventsRepository} implementation. */
export const TRIP_EVENTS_REPOSITORY = Symbol('TRIP_EVENTS_REPOSITORY');

/**
 * Persistence port for the append-only trip event log.
 *
 * Rows are immutable (a database trigger blocks update/delete); this port only
 * inserts (always within the same transaction as the lifecycle change it
 * records) and reads. Reads are scoped by `(tripId, companyId)` — the caller
 * verifies the trip belongs to the tenant company first.
 */
export interface TripEventsRepository {
  /** Append one event for a trip within the company. */
  append(
    executor: DatabaseExecutor,
    companyId: string,
    tripId: string,
    input: TripEventCreate,
  ): Promise<TripEvent>;

  /** A page of a trip's events, newest first. */
  listByTrip(
    executor: DatabaseExecutor,
    companyId: string,
    tripId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<TripEvent>>;
}
