import type { Route } from './route.types';

/**
 * Raw `routes` row. bigint columns arrive as strings from `pg`; the
 * `numeric` price/distance columns also arrive as strings to preserve precision.
 */
export interface RouteRow {
  id: string;
  company_id: string;
  origin_station_id: string;
  destination_station_id: string;
  default_price_mru: string;
  currency: string;
  estimated_duration_minutes: number;
  distance_km: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Explicit, non-`SELECT *` column list (aligned with {@link RouteRow}). */
export const ROUTE_COLUMNS =
  'id, company_id, origin_station_id, destination_station_id, default_price_mru, currency, estimated_duration_minutes, distance_km, is_active, created_at, updated_at';

export function toRoute(row: RouteRow): Route {
  return {
    id: row.id,
    companyId: row.company_id,
    originStationId: row.origin_station_id,
    destinationStationId: row.destination_station_id,
    defaultPriceMru: Number(row.default_price_mru),
    currency: row.currency,
    estimatedDurationMinutes: row.estimated_duration_minutes,
    distanceKm: Number(row.distance_km),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
