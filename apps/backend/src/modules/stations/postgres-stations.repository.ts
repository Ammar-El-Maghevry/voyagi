import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { DatabaseService } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { STATION_COLUMNS, type StationRow, toStation } from './station.mapper';
import type { PagedResult, StationsRepository } from './stations.repository';
import type { Station } from './station.types';

/**
 * PostgreSQL adapter for stations. Every statement is parameterized, selects
 * explicit columns, and returns only active, non-deleted rows in a stable
 * order — matching the RLS `stations_read_active` policy. Stations are global
 * reference data, so there is no tenant predicate; an optional `cityId` narrows
 * the listing.
 */
@Injectable()
export class PostgresStationsRepository implements StationsRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseExecutor,
  ) {}

  async listActive(
    pagination: ResolvedPagination,
    cityId?: string,
  ): Promise<PagedResult<Station>> {
    // Build the shared filter once so the list and count stay consistent.
    const filters = ['is_active', 'deleted_at IS NULL'];
    const filterParams: unknown[] = [];
    if (cityId !== undefined) {
      filterParams.push(cityId);
      filters.push(`city_id = $${filterParams.length}`);
    }
    const where = filters.join(' AND ');

    const rows = await this.database.query<StationRow>(
      `SELECT ${STATION_COLUMNS}
         FROM public.stations
         WHERE ${where}
         ORDER BY id
         LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
      [...filterParams, pagination.limit, pagination.offset],
      { name: 'stations.list_active' },
    );
    const total = await this.count(
      `SELECT count(*)::text AS total FROM public.stations WHERE ${where}`,
      filterParams,
      'stations.count_active',
    );
    return { items: rows.rows.map(toStation), total };
  }

  async findActiveById(stationId: string): Promise<Station | null> {
    const result = await this.database.query<StationRow>(
      `SELECT ${STATION_COLUMNS}
         FROM public.stations
         WHERE id = $1 AND is_active AND deleted_at IS NULL`,
      [stationId],
      { name: 'stations.find_active' },
    );
    const row = result.rows[0];
    return row ? toStation(row) : null;
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
}
