import { parseTripStatus } from './trip-status';
import type { Trip } from './trip.types';

/** Raw `trips` row (bigint/numeric columns arrive as strings from `pg`). */
export interface TripRow {
  id: string;
  company_id: string;
  route_id: string;
  bus_id: string;
  driver_id: string | null;
  assistant_id: string | null;
  departure_time: Date;
  estimated_arrival_time: Date;
  actual_departure_time: Date | null;
  actual_arrival_time: Date | null;
  boarding_closes_at: Date;
  price_mru: string;
  currency: string;
  status: string;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

/** Explicit, non-`SELECT *` column list (aligned with {@link TripRow}). */
export const TRIP_COLUMNS =
  'id, company_id, route_id, bus_id, driver_id, assistant_id, departure_time, estimated_arrival_time, actual_departure_time, actual_arrival_time, boarding_closes_at, price_mru, currency, status, is_active, version, created_at, updated_at';

/**
 * Map a trip row to the domain type, or `null` when its `status` is not a value
 * this application version knows (fail closed — the caller excludes it).
 */
export function toTrip(row: TripRow): Trip | null {
  const status = parseTripStatus(row.status);
  if (status === null) {
    return null;
  }
  return {
    id: row.id,
    companyId: row.company_id,
    routeId: row.route_id,
    busId: row.bus_id,
    driverId: row.driver_id === null ? undefined : row.driver_id,
    assistantId: row.assistant_id === null ? undefined : row.assistant_id,
    departureTime: row.departure_time,
    estimatedArrivalTime: row.estimated_arrival_time,
    actualDepartureTime:
      row.actual_departure_time === null ? undefined : row.actual_departure_time,
    actualArrivalTime:
      row.actual_arrival_time === null ? undefined : row.actual_arrival_time,
    boardingClosesAt: row.boarding_closes_at,
    priceMru: Number(row.price_mru),
    currency: row.currency,
    status,
    isActive: row.is_active,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
