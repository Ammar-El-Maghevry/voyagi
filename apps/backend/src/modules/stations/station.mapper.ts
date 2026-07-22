import type { Station } from './station.types';

/**
 * Raw `stations` row. bigint columns arrive as strings from `pg`; the
 * `numeric(9,6)` latitude/longitude also arrive as strings (or `null`) to
 * preserve precision.
 */
export interface StationRow {
  id: string;
  city_id: string;
  name_ar: string;
  name_fr: string;
  latitude: string | null;
  longitude: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Explicit, non-`SELECT *` column list (aligned with {@link StationRow}). */
export const STATION_COLUMNS =
  'id, city_id, name_ar, name_fr, latitude, longitude, is_active, created_at, updated_at';

/** Parse a nullable `numeric` string coordinate into a number, or `undefined`. */
function toCoordinate(value: string | null): number | undefined {
  return value === null ? undefined : Number(value);
}

export function toStation(row: StationRow): Station {
  return {
    id: row.id,
    cityId: row.city_id,
    nameAr: row.name_ar,
    nameFr: row.name_fr,
    latitude: toCoordinate(row.latitude),
    longitude: toCoordinate(row.longitude),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
