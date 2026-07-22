import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { City } from './city.types';

/** A single page of rows plus the unbounded total, for building pagination meta. */
export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** DI token bound to the concrete {@link CitiesRepository} implementation. */
export const CITIES_REPOSITORY = Symbol('CITIES_REPOSITORY');

/**
 * Persistence port for cities.
 *
 * Cities are global reference data (no tenant scope). Reads expose active rows
 * only, mirroring the RLS `cities_read_active` policy. There are no write
 * methods: management of the reference catalog is not part of this phase.
 */
export interface CitiesRepository {
  /** A page of active cities, in a stable order. */
  listActive(pagination: ResolvedPagination): Promise<PagedResult<City>>;

  /** A single active city by id, or `null` when absent/inactive. */
  findActiveById(cityId: string): Promise<City | null>;
}
