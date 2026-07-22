import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { DatabaseService } from '../../infrastructure/database';
import { parsePositiveBigInt } from '../identity/identifier.util';
import { TripNotFoundError } from './trip.errors';
import type { TripEvent } from './trip-event.types';
import {
  TRIP_EVENTS_REPOSITORY,
  type TripEventsRepository,
} from './trip-events.repository';
import {
  TRIPS_REPOSITORY,
  type PagedResult,
  type TripsRepository,
} from './trips.repository';

/**
 * Read side of the append-only trip event log. Verifies the trip belongs to the
 * tenant company (the events table is scoped by `(trip_id, company_id)`) before
 * returning its history. `trips.read` governs access (enforced by the guard).
 */
@Injectable()
export class TripEventsService {
  constructor(
    @Inject(TRIP_EVENTS_REPOSITORY)
    private readonly events: TripEventsRepository,
    @Inject(TRIPS_REPOSITORY)
    private readonly trips: TripsRepository,
    private readonly db: DatabaseService,
  ) {}

  /** A page of a trip's events, or {@link TripNotFoundError} if the trip is not in the company. */
  async listTripEvents(
    companyId: string,
    tripId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<TripEvent>> {
    const c = parsePositiveBigInt(companyId);
    const t = parsePositiveBigInt(tripId);
    if (c === null || t === null) {
      throw new TripNotFoundError();
    }
    const trip = await this.trips.findInCompany(this.db, c, t);
    if (!trip) {
      throw new TripNotFoundError();
    }
    return this.events.listByTrip(this.db, c, t, pagination);
  }
}
