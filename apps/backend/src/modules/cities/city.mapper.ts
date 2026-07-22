import type { City } from './city.types';

/** Raw `cities` row (bigint columns arrive as strings from `pg`). */
export interface CityRow {
  id: string;
  name_ar: string;
  name_fr: string;
  is_active: boolean;
  created_at: Date;
}

/** Explicit, non-`SELECT *` column list (aligned with {@link CityRow}). */
export const CITY_COLUMNS = 'id, name_ar, name_fr, is_active, created_at';

export function toCity(row: CityRow): City {
  return {
    id: row.id,
    nameAr: row.name_ar,
    nameFr: row.name_fr,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}
