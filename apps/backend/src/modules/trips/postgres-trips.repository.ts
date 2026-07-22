import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { TRIP_COLUMNS, type TripRow, toTrip } from './trip.mapper';
import type { TripStatus } from './trip-status';
import type { TripTimestampField } from './trip-transitions';
import type {
  BusAssignment,
  PagedResult,
  RouteAssignment,
  StaffAssignment,
  TripsRepository,
} from './trips.repository';
import type { Trip, TripInsert, TripUpdate } from './trip.types';

/** Platform default boarding-close window when a company has no settings row. */
const DEFAULT_BOARDING_CLOSE_MINUTES = 30;

/**
 * PostgreSQL adapter for trips. Every statement is parameterized, selects
 * explicit columns, and scopes by `company_id`. Mutations increment `version`
 * and are single atomic statements. Stateless w.r.t. the executor — each method
 * runs on the {@link DatabaseExecutor} it is handed (pool or transaction).
 */
@Injectable()
export class PostgresTripsRepository implements TripsRepository {
  private readonly logger = new Logger(PostgresTripsRepository.name);

  async listByCompany(
    executor: DatabaseExecutor,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Trip>> {
    const rows = await executor.query<TripRow>(
      `SELECT ${TRIP_COLUMNS}
         FROM public.trips
         WHERE company_id = $1
         ORDER BY departure_time DESC, id DESC
         LIMIT $2 OFFSET $3`,
      [companyId, pagination.limit, pagination.offset],
      { name: 'trips.list_for_company' },
    );
    const total = await this.count(
      executor,
      `SELECT count(*)::text AS total FROM public.trips WHERE company_id = $1`,
      [companyId],
      'trips.count_for_company',
    );
    return { items: this.mapRows(rows.rows), total };
  }

  async findInCompany(
    executor: DatabaseExecutor,
    companyId: string,
    tripId: string,
  ): Promise<Trip | null> {
    const result = await executor.query<TripRow>(
      `SELECT ${TRIP_COLUMNS}
         FROM public.trips
         WHERE id = $1 AND company_id = $2`,
      [tripId, companyId],
      { name: 'trips.find_in_company' },
    );
    return this.mapOne(result.rows[0]);
  }

  async findRouteAssignment(
    executor: DatabaseExecutor,
    companyId: string,
    routeId: string,
  ): Promise<RouteAssignment | null> {
    const result = await executor.query<{
      is_active: boolean;
      default_price_mru: string;
      currency: string;
    }>(
      `SELECT is_active, default_price_mru, currency
         FROM public.routes
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [routeId, companyId],
      { name: 'trips.find_route_assignment' },
    );
    const row = result.rows[0];
    return row
      ? {
          isActive: row.is_active,
          defaultPriceMru: Number(row.default_price_mru),
          currency: row.currency,
        }
      : null;
  }

  async findBusAssignment(
    executor: DatabaseExecutor,
    companyId: string,
    busId: string,
  ): Promise<BusAssignment | null> {
    const result = await executor.query<{ is_active: boolean; status: string }>(
      `SELECT is_active, status
         FROM public.buses
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [busId, companyId],
      { name: 'trips.find_bus_assignment' },
    );
    const row = result.rows[0];
    return row ? { isActive: row.is_active, status: row.status } : null;
  }

  async findStaffAssignment(
    executor: DatabaseExecutor,
    companyId: string,
    staffId: string,
  ): Promise<StaffAssignment | null> {
    const result = await executor.query<{ is_active: boolean; staff_type: string }>(
      `SELECT is_active, staff_type
         FROM public.staff_members
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [staffId, companyId],
      { name: 'trips.find_staff_assignment' },
    );
    const row = result.rows[0];
    return row ? { isActive: row.is_active, staffType: row.staff_type } : null;
  }

  async readBoardingCloseMinutes(
    executor: DatabaseExecutor,
    companyId: string,
  ): Promise<number> {
    const result = await executor.query<{ boarding_close_minutes: number }>(
      `SELECT boarding_close_minutes
         FROM public.company_settings
         WHERE company_id = $1`,
      [companyId],
      { name: 'trips.read_boarding_close_minutes' },
    );
    return result.rows[0]?.boarding_close_minutes ?? DEFAULT_BOARDING_CLOSE_MINUTES;
  }

  async insert(
    executor: DatabaseExecutor,
    companyId: string,
    input: TripInsert,
  ): Promise<Trip> {
    const result = await executor.query<TripRow>(
      `INSERT INTO public.trips
         (company_id, route_id, bus_id, driver_id, assistant_id,
          departure_time, estimated_arrival_time, boarding_closes_at,
          price_mru, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${TRIP_COLUMNS}`,
      [
        companyId,
        input.routeId,
        input.busId,
        input.driverId ?? null,
        input.assistantId ?? null,
        input.departureTime,
        input.estimatedArrivalTime,
        input.boardingClosesAt,
        input.priceMru,
        input.currency,
      ],
      { name: 'trips.insert' },
    );
    const mapped = this.mapOne(result.rows[0]);
    if (!mapped) {
      throw new Error('trips insert returned an unrecognized status');
    }
    return mapped;
  }

  async updateDetails(
    executor: DatabaseExecutor,
    companyId: string,
    tripId: string,
    expectedVersion: number,
    input: TripUpdate,
    boardingClosesAt: Date | null,
  ): Promise<Trip | null> {
    const assignments: string[] = [];
    const params: unknown[] = [tripId, companyId, expectedVersion];

    if (input.departureTime !== undefined) {
      params.push(input.departureTime);
      assignments.push(`departure_time = $${params.length}`);
    }
    if (input.estimatedArrivalTime !== undefined) {
      params.push(input.estimatedArrivalTime);
      assignments.push(`estimated_arrival_time = $${params.length}`);
    }
    if (input.driverId !== undefined) {
      params.push(input.driverId);
      assignments.push(`driver_id = $${params.length}`);
    }
    if (input.assistantId !== undefined) {
      params.push(input.assistantId);
      assignments.push(`assistant_id = $${params.length}`);
    }
    if (boardingClosesAt !== null) {
      params.push(boardingClosesAt);
      assignments.push(`boarding_closes_at = $${params.length}`);
    }

    const result = await executor.query<TripRow>(
      `UPDATE public.trips
         SET ${assignments.join(', ')}, version = version + 1, updated_at = now()
         WHERE id = $1 AND company_id = $2
           AND status = 'SCHEDULED'::public.trip_status_enum
           AND version = $3
         RETURNING ${TRIP_COLUMNS}`,
      params,
      { name: 'trips.update_details' },
    );
    return this.mapOne(result.rows[0]);
  }

  async transition(
    executor: DatabaseExecutor,
    companyId: string,
    tripId: string,
    from: readonly TripStatus[],
    to: TripStatus,
    stamps: TripTimestampField,
  ): Promise<Trip | null> {
    // `stamps` and `to` come from the fixed transition matrix, never user input,
    // so composing them into the statement is injection-safe.
    const stampClause = stamps ? `, ${stamps} = now()` : '';
    const result = await executor.query<TripRow>(
      `UPDATE public.trips
         SET status = $3::public.trip_status_enum${stampClause},
             version = version + 1, updated_at = now()
         WHERE id = $1 AND company_id = $2
           AND status = ANY($4::public.trip_status_enum[])
         RETURNING ${TRIP_COLUMNS}`,
      [tripId, companyId, to, from],
      { name: 'trips.transition' },
    );
    return this.mapOne(result.rows[0]);
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

  private mapRows(rows: readonly TripRow[]): Trip[] {
    const mapped = rows.map((row) => toTrip(row));
    this.warnUnknownStatuses(mapped.filter((t) => t === null).length);
    return mapped.filter((t): t is Trip => t !== null);
  }

  private mapOne(row: TripRow | undefined): Trip | null {
    if (!row) {
      return null;
    }
    const mapped = toTrip(row);
    if (mapped === null) {
      this.warnUnknownStatuses(1);
      return null;
    }
    return mapped;
  }

  private warnUnknownStatuses(skipped: number): void {
    if (skipped > 0) {
      this.logger.warn({ event: 'unknown_trip_status_skipped', skipped });
    }
  }
}
