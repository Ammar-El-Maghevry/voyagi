import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { DatabaseService } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { BUS_COLUMNS, type BusRow, toBus } from './bus.mapper';
import type { BusesRepository, PagedResult } from './buses.repository';
import type { Bus, BusCreate, BusUpdate } from './bus.types';

/**
 * PostgreSQL adapter for buses. Every statement is parameterized, selects
 * explicit columns, scopes by `company_id`, and excludes soft-deleted rows. On
 * the backend's trusted (RLS-bypassing) connection, the `company_id` predicates
 * are the authoritative tenant boundary. Mutations increment `version` and are
 * single atomic statements — no read-then-write.
 */
@Injectable()
export class PostgresBusesRepository implements BusesRepository {
  private readonly logger = new Logger(PostgresBusesRepository.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseExecutor,
  ) {}

  async listByCompany(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Bus>> {
    const rows = await this.database.query<BusRow>(
      `SELECT ${BUS_COLUMNS}
         FROM public.buses
         WHERE company_id = $1 AND deleted_at IS NULL
         ORDER BY id
         LIMIT $2 OFFSET $3`,
      [companyId, pagination.limit, pagination.offset],
      { name: 'buses.list_for_company' },
    );
    const total = await this.count(
      `SELECT count(*)::text AS total
         FROM public.buses
         WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId],
      'buses.count_for_company',
    );
    return { items: this.mapRows(rows.rows), total };
  }

  async findInCompany(companyId: string, busId: string): Promise<Bus | null> {
    const result = await this.database.query<BusRow>(
      `SELECT ${BUS_COLUMNS}
         FROM public.buses
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [busId, companyId],
      { name: 'buses.find_in_company' },
    );
    return this.mapOne(result.rows[0]);
  }

  async create(companyId: string, input: BusCreate): Promise<Bus> {
    const result = await this.database.query<BusRow>(
      `INSERT INTO public.buses
         (company_id, seat_layout_id, plate_number, bus_model, current_odometer_km)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${BUS_COLUMNS}`,
      [
        companyId,
        input.seatLayoutId,
        input.plateNumber,
        input.busModel ?? null,
        input.currentOdometerKm ?? 0,
      ],
      { name: 'buses.insert' },
    );
    const mapped = this.mapOne(result.rows[0]);
    // Just inserted with the database default status, so this never fails; guard
    // defensively so an impossible unknown status surfaces as a dependency error
    // rather than a null the caller must interpret.
    if (!mapped) {
      throw new Error('buses insert returned an unrecognized status');
    }
    return mapped;
  }

  async update(
    companyId: string,
    busId: string,
    input: BusUpdate,
  ): Promise<Bus | null> {
    const assignments: string[] = [];
    const params: unknown[] = [busId, companyId];

    if (input.seatLayoutId !== undefined) {
      params.push(input.seatLayoutId);
      assignments.push(`seat_layout_id = $${params.length}`);
    }
    if (input.plateNumber !== undefined) {
      params.push(input.plateNumber);
      assignments.push(`plate_number = $${params.length}`);
    }
    if (input.busModel !== undefined) {
      params.push(input.busModel);
      assignments.push(`bus_model = $${params.length}`);
    }
    if (input.currentOdometerKm !== undefined) {
      params.push(input.currentOdometerKm);
      assignments.push(`current_odometer_km = $${params.length}`);
    }

    const result = await this.database.query<BusRow>(
      `UPDATE public.buses
         SET ${assignments.join(', ')}, version = version + 1, updated_at = now()
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
         RETURNING ${BUS_COLUMNS}`,
      params,
      { name: 'buses.update' },
    );
    return this.mapOne(result.rows[0]);
  }

  async transitionActive(
    companyId: string,
    busId: string,
    target: boolean,
  ): Promise<Bus | null> {
    const result = await this.database.query<BusRow>(
      `UPDATE public.buses
         SET is_active = $3, version = version + 1, updated_at = now()
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
           AND is_active = NOT $3
         RETURNING ${BUS_COLUMNS}`,
      [busId, companyId, target],
      { name: 'buses.transition_active' },
    );
    return this.mapOne(result.rows[0]);
  }

  private async count(
    text: string,
    params: readonly unknown[],
    name: string,
  ): Promise<number> {
    const result = await this.database.query<{ total: string }>(text, params, {
      name,
    });
    return Number(result.rows[0]?.total ?? 0);
  }

  private mapRows(rows: readonly BusRow[]): Bus[] {
    const mapped = rows.map((row) => toBus(row));
    this.warnUnknownStatuses(mapped.filter((b) => b === null).length);
    return mapped.filter((b): b is Bus => b !== null);
  }

  private mapOne(row: BusRow | undefined): Bus | null {
    if (!row) {
      return null;
    }
    const mapped = toBus(row);
    if (mapped === null) {
      this.warnUnknownStatuses(1);
      return null;
    }
    return mapped;
  }

  /** Count-only observation of rows dropped for an unrecognized status. */
  private warnUnknownStatuses(skipped: number): void {
    if (skipped > 0) {
      this.logger.warn({ event: 'unknown_bus_status_skipped', skipped });
    }
  }
}
