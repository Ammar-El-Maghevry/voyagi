import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { MAINTENANCE_COLUMNS, type MaintenanceRow, toMaintenanceRecord } from './maintenance.mapper';
import type { MaintenanceStatus } from './maintenance-status';
import type { MaintenanceRepository, PagedResult } from './maintenance.repository';
import type { LockedBus, MaintenanceCreate, MaintenanceRecord } from './maintenance.types';

@Injectable()
export class PostgresMaintenanceRepository implements MaintenanceRepository {
  private readonly logger = new Logger(PostgresMaintenanceRepository.name);

  async listByCompany(
    executor: DatabaseExecutor,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<MaintenanceRecord>> {
    const rows = await executor.query<MaintenanceRow>(
      `SELECT ${MAINTENANCE_COLUMNS}
         FROM public.vehicle_maintenance_records
         WHERE company_id = $1
         ORDER BY started_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
      [companyId, pagination.limit, pagination.offset],
      { name: 'maintenance.list_for_company' },
    );
    const total = await executor.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM public.vehicle_maintenance_records
         WHERE company_id = $1`,
      [companyId],
      { name: 'maintenance.count_for_company' },
    );
    return { items: this.mapRows(rows.rows), total: Number(total.rows[0]?.total ?? 0) };
  }

  async findInCompany(executor: DatabaseExecutor, companyId: string, recordId: string): Promise<MaintenanceRecord | null> {
    const result = await executor.query<MaintenanceRow>(
      `SELECT ${MAINTENANCE_COLUMNS}
         FROM public.vehicle_maintenance_records
         WHERE id = $1 AND company_id = $2`,
      [recordId, companyId],
      { name: 'maintenance.find_in_company' },
    );
    return this.mapOne(result.rows[0]);
  }

  async lockBus(executor: DatabaseExecutor, companyId: string, busId: string): Promise<LockedBus | null> {
    const result = await executor.query<{ is_active: boolean; status: string }>(
      `SELECT is_active, status
         FROM public.buses
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
      [busId, companyId],
      { name: 'maintenance.lock_bus' },
    );
    const row = result.rows[0];
    return row ? { isActive: row.is_active, status: row.status } : null;
  }

  async hasActiveRecord(executor: DatabaseExecutor, companyId: string, busId: string, exceptRecordId?: string): Promise<boolean> {
    const result = await executor.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM public.vehicle_maintenance_records
          WHERE company_id = $1 AND bus_id = $2
            AND status IN ('SCHEDULED', 'IN_PROGRESS')
            AND ($3::bigint IS NULL OR id <> $3)
       ) AS exists`,
      [companyId, busId, exceptRecordId ?? null],
      { name: 'maintenance.has_active_record' },
    );
    return result.rows[0]?.exists ?? false;
  }

  async hasLiveTripOverlap(
    executor: DatabaseExecutor,
    companyId: string,
    busId: string,
    startsAt: Date,
    endsAt: Date | null,
  ): Promise<boolean> {
    const result = await executor.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM public.trips
          WHERE company_id = $1 AND bus_id = $2
            AND is_active AND status <> 'CANCELLED'::public.trip_status_enum
            AND tstzrange(departure_time, estimated_arrival_time, '[)')
                && tstzrange($3::timestamptz, COALESCE($4::timestamptz, 'infinity'::timestamptz), '[)')
       ) AS exists`,
      [companyId, busId, startsAt, endsAt],
      { name: 'maintenance.has_live_trip_overlap' },
    );
    return result.rows[0]?.exists ?? false;
  }

  async insert(executor: DatabaseExecutor, companyId: string, input: MaintenanceCreate, actorUserId: string): Promise<MaintenanceRecord> {
    const result = await executor.query<MaintenanceRow>(
      `INSERT INTO public.vehicle_maintenance_records
         (bus_id, company_id, maintenance_type, description, cost_mru, odometer_km,
          started_at, scheduled_ends_at, next_maintenance_at, created_by_user_id)
       VALUES ($1, $2, $3::public.maintenance_type_enum, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${MAINTENANCE_COLUMNS}`,
      [
        input.busId,
        companyId,
        input.maintenanceType,
        input.description ?? null,
        input.costMru ?? null,
        input.odometerKm ?? null,
        input.startedAt,
        input.scheduledEndsAt,
        input.nextMaintenanceAt ?? null,
        actorUserId,
      ],
      { name: 'maintenance.insert' },
    );
    const mapped = this.mapOne(result.rows[0]);
    if (!mapped) {
      throw new Error('maintenance insert returned an unrecognized enum value');
    }
    return mapped;
  }

  async transition(
    executor: DatabaseExecutor,
    companyId: string,
    recordId: string,
    from: readonly MaintenanceStatus[],
    to: MaintenanceStatus,
    stampsCompletedAt: boolean,
  ): Promise<MaintenanceRecord | null> {
    const completedClause = stampsCompletedAt ? ', completed_at = now()' : '';
    const result = await executor.query<MaintenanceRow>(
      `UPDATE public.vehicle_maintenance_records
          SET status = $3::public.maintenance_status_enum${completedClause}, updated_at = now()
        WHERE id = $1 AND company_id = $2
          AND status = ANY($4::public.maintenance_status_enum[])
        RETURNING ${MAINTENANCE_COLUMNS}`,
      [recordId, companyId, to, from],
      { name: 'maintenance.transition' },
    );
    return this.mapOne(result.rows[0]);
  }

  async setBusInMaintenance(executor: DatabaseExecutor, companyId: string, busId: string): Promise<boolean> {
    const result = await executor.query(
      `UPDATE public.buses
          SET status = 'IN_MAINTENANCE'::public.bus_status_enum, version = version + 1, updated_at = now()
        WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
          AND status = 'ACTIVE'::public.bus_status_enum`,
      [busId, companyId],
      { name: 'maintenance.set_bus_in_maintenance' },
    );
    return result.rowCount === 1;
  }

  async restoreBusActiveIfInMaintenance(executor: DatabaseExecutor, companyId: string, busId: string): Promise<void> {
    await executor.query(
      `UPDATE public.buses
          SET status = 'ACTIVE'::public.bus_status_enum, version = version + 1, updated_at = now()
        WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
          AND status = 'IN_MAINTENANCE'::public.bus_status_enum`,
      [busId, companyId],
      { name: 'maintenance.restore_bus_active' },
    );
  }

  async hasActiveMaintenanceOverlap(
    executor: DatabaseExecutor,
    companyId: string,
    busId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<boolean> {
    const result = await executor.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM public.vehicle_maintenance_records
          WHERE company_id = $1 AND bus_id = $2
            AND status IN ('SCHEDULED', 'IN_PROGRESS')
            AND tstzrange(started_at,
                CASE WHEN status = 'IN_PROGRESS' THEN 'infinity'::timestamptz ELSE scheduled_ends_at END,
                '[)') && tstzrange($3::timestamptz, $4::timestamptz, '[)')
       ) AS exists`,
      [companyId, busId, startsAt, endsAt],
      { name: 'maintenance.has_active_overlap' },
    );
    return result.rows[0]?.exists ?? false;
  }

  private mapRows(rows: readonly MaintenanceRow[]): MaintenanceRecord[] {
    return rows.map((row) => this.mapOne(row)).filter((record): record is MaintenanceRecord => record !== null);
  }

  private mapOne(row: MaintenanceRow | undefined): MaintenanceRecord | null {
    if (!row) {
      return null;
    }
    const mapped = toMaintenanceRecord(row);
    if (!mapped) {
      this.logger.warn({ event: 'unknown_maintenance_enum_skipped' });
    }
    return mapped;
  }
}
