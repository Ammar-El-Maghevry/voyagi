import { parseMaintenanceStatus } from './maintenance-status';
import { MaintenanceType } from './maintenance-type';
import type { MaintenanceRecord } from './maintenance.types';

export interface MaintenanceRow {
  id: string;
  company_id: string;
  bus_id: string;
  maintenance_type: string;
  description: string | null;
  status: string;
  cost_mru: string | null;
  odometer_km: number | null;
  started_at: Date;
  scheduled_ends_at: Date | null;
  completed_at: Date | null;
  next_maintenance_at: Date | null;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export const MAINTENANCE_COLUMNS =
  'id, company_id, bus_id, maintenance_type, description, status, cost_mru, odometer_km, started_at, scheduled_ends_at, completed_at, next_maintenance_at, created_by_user_id, created_at, updated_at';

const MAINTENANCE_TYPES: ReadonlySet<string> = new Set(Object.values(MaintenanceType));

export function toMaintenanceRecord(row: MaintenanceRow): MaintenanceRecord | null {
  const status = parseMaintenanceStatus(row.status);
  if (status === null || !MAINTENANCE_TYPES.has(row.maintenance_type)) {
    return null;
  }
  return {
    id: row.id,
    companyId: row.company_id,
    busId: row.bus_id,
    maintenanceType: row.maintenance_type as MaintenanceType,
    description: row.description ?? undefined,
    status,
    costMru: row.cost_mru === null ? undefined : Number(row.cost_mru),
    odometerKm: row.odometer_km ?? undefined,
    startedAt: row.started_at,
    scheduledEndsAt: row.scheduled_ends_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    nextMaintenanceAt: row.next_maintenance_at ?? undefined,
    createdByUserId: row.created_by_user_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
