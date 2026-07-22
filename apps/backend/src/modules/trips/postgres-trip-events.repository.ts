import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import {
  TRIP_EVENT_COLUMNS,
  type TripEventRow,
  toTripEvent,
} from './trip-event.mapper';
import type { TripEventsRepository } from './trip-events.repository';
import type { TripEvent, TripEventCreate } from './trip-event.types';
import type { PagedResult } from './trips.repository';

/**
 * PostgreSQL adapter for trip events. Inserts are append-only (a database
 * trigger blocks any update/delete). Reads select explicit columns scoped by
 * `(trip_id, company_id)`.
 */
@Injectable()
export class PostgresTripEventsRepository implements TripEventsRepository {
  private readonly logger = new Logger(PostgresTripEventsRepository.name);

  async append(
    executor: DatabaseExecutor,
    companyId: string,
    tripId: string,
    input: TripEventCreate,
  ): Promise<TripEvent> {
    const result = await executor.query<TripEventRow>(
      `INSERT INTO public.trip_events
         (trip_id, company_id, actor_user_id, event_type, event_source)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${TRIP_EVENT_COLUMNS}`,
      [
        tripId,
        companyId,
        input.actorUserId ?? null,
        input.eventType,
        input.eventSource,
      ],
      { name: 'trip_events.append' },
    );
    const mapped = toTripEvent(result.rows[0]);
    if (!mapped) {
      throw new Error('trip_events insert returned an unrecognized type/source');
    }
    return mapped;
  }

  async listByTrip(
    executor: DatabaseExecutor,
    companyId: string,
    tripId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<TripEvent>> {
    const rows = await executor.query<TripEventRow>(
      `SELECT ${TRIP_EVENT_COLUMNS}
         FROM public.trip_events
         WHERE trip_id = $1 AND company_id = $2
         ORDER BY event_time DESC, id DESC
         LIMIT $3 OFFSET $4`,
      [tripId, companyId, pagination.limit, pagination.offset],
      { name: 'trip_events.list_by_trip' },
    );
    const total = await this.count(
      executor,
      `SELECT count(*)::text AS total
         FROM public.trip_events
         WHERE trip_id = $1 AND company_id = $2`,
      [tripId, companyId],
      'trip_events.count_by_trip',
    );
    const mapped = rows.rows.map((row) => toTripEvent(row));
    const skipped = mapped.filter((e) => e === null).length;
    if (skipped > 0) {
      this.logger.warn({ event: 'unknown_trip_event_skipped', skipped });
    }
    return {
      items: mapped.filter((e): e is TripEvent => e !== null),
      total,
    };
  }

  private async count(
    executor: DatabaseExecutor,
    text: string,
    params: readonly unknown[],
    name: string,
  ): Promise<number> {
    const result = await executor.query<{ total: string }>(text, params, {
      name,
    });
    return Number(result.rows[0]?.total ?? 0);
  }
}
