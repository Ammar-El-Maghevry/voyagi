import type { ResolvedPagination } from '../../src/common/pagination/pagination';
import type { DatabaseExecutor } from '../../src/infrastructure/database/database.types';
import type { TripEventsRepository } from '../../src/modules/trips/trip-events.repository';
import type {
  TripEvent,
  TripEventCreate,
} from '../../src/modules/trips/trip-event.types';
import type { PagedResult } from '../../src/modules/trips/trips.repository';

/**
 * In-memory {@link TripEventsRepository} for e2e tests. Append-only, scoped by
 * `(trip, company)`, newest first — no real database.
 */
export class InMemoryTripEventsRepository implements TripEventsRepository {
  private readonly events: TripEvent[] = [];
  private sequence = 9500;

  append(
    _e: DatabaseExecutor,
    companyId: string,
    tripId: string,
    input: TripEventCreate,
  ): Promise<TripEvent> {
    const event: TripEvent = {
      id: String(++this.sequence),
      tripId,
      companyId,
      actorUserId: input.actorUserId,
      eventType: input.eventType,
      eventSource: input.eventSource,
      eventTime: new Date(),
      createdAt: new Date(),
    };
    this.events.push(event);
    return Promise.resolve(event);
  }

  listByTrip(
    _e: DatabaseExecutor,
    companyId: string,
    tripId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<TripEvent>> {
    const all = this.events
      .filter((e) => e.tripId === tripId && e.companyId === companyId)
      .reverse();
    return Promise.resolve({
      items: all.slice(pagination.offset, pagination.offset + pagination.limit),
      total: all.length,
    });
  }
}
