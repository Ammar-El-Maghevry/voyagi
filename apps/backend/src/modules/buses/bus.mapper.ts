import { parseBusStatus } from './bus-status';
import type { Bus } from './bus.types';

/** Raw `buses` row (bigint columns arrive as strings from `pg`). */
export interface BusRow {
  id: string;
  company_id: string;
  seat_layout_id: string;
  plate_number: string;
  bus_model: string | null;
  status: string;
  is_active: boolean;
  current_odometer_km: number;
  version: number;
  created_at: Date;
  updated_at: Date;
}

/** Explicit, non-`SELECT *` column list (aligned with {@link BusRow}). */
export const BUS_COLUMNS =
  'id, company_id, seat_layout_id, plate_number, bus_model, status, is_active, current_odometer_km, version, created_at, updated_at';

/**
 * Map a bus row to the domain type, or `null` when its `status` is not a value
 * this application version knows (fail closed — the caller excludes it).
 */
export function toBus(row: BusRow): Bus | null {
  const status = parseBusStatus(row.status);
  if (status === null) {
    return null;
  }
  return {
    id: row.id,
    companyId: row.company_id,
    seatLayoutId: row.seat_layout_id,
    plateNumber: row.plate_number,
    busModel: row.bus_model === null ? undefined : row.bus_model,
    status,
    isActive: row.is_active,
    currentOdometerKm: row.current_odometer_km,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
