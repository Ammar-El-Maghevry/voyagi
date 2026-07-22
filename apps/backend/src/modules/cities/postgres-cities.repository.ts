import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { DatabaseService } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { CITY_COLUMNS, type CityRow, toCity } from './city.mapper';
import type { CitiesRepository, PagedResult } from './cities.repository';
import type { City } from './city.types';

/**
 * PostgreSQL adapter for cities. Every statement is parameterized, selects
 * explicit columns, and returns only active rows (`is_active`) in a stable
 * order — matching the RLS `cities_read_active` read policy. Cities are global,
 * so there is no tenant predicate.
 */
@Injectable()
export class PostgresCitiesRepository implements CitiesRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseExecutor,
  ) {}

  async listActive(
    pagination: ResolvedPagination,
  ): Promise<PagedResult<City>> {
    const rows = await this.database.query<CityRow>(
      `SELECT ${CITY_COLUMNS}
         FROM public.cities
         WHERE is_active
         ORDER BY id
         LIMIT $1 OFFSET $2`,
      [pagination.limit, pagination.offset],
      { name: 'cities.list_active' },
    );
    const total = await this.count(
      `SELECT count(*)::text AS total FROM public.cities WHERE is_active`,
      [],
      'cities.count_active',
    );
    return { items: rows.rows.map(toCity), total };
  }

  async findActiveById(cityId: string): Promise<City | null> {
    const result = await this.database.query<CityRow>(
      `SELECT ${CITY_COLUMNS}
         FROM public.cities
         WHERE id = $1 AND is_active`,
      [cityId],
      { name: 'cities.find_active' },
    );
    const row = result.rows[0];
    return row ? toCity(row) : null;
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
