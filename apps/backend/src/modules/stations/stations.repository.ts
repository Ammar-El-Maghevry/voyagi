import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { Station } from './station.types';

/** A single page of rows plus the unbounded total, for building pagination meta. */
export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** DI token bound to the concrete {@link StationsRepository} implementation. */
export const STATIONS_REPOSITORY = Symbol('STATIONS_REPOSITORY');

/**
 * Persistence port for stations.
 *
 * Stations are city-scoped reference data (not tenant-owned). Reads expose
 * active, non-deleted rows only, mirroring the RLS `stations_read_active`
 * policy, and may be narrowed to a single city. There are no write methods:
 * management of the reference catalog is not part of this phase.
 */
export interface StationsRepository {
  /**
   * A page of active stations, optionally restricted to one `cityId`, in a
   * stable order.
   */
  listActive(
    pagination: ResolvedPagination,
    cityId?: string,
  ): Promise<PagedResult<Station>>;

  /** A single active station by id, or `null` when absent/inactive/deleted. */
  findActiveById(stationId: string): Promise<Station | null>;
}
