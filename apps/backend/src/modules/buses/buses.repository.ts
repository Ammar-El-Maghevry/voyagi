import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { Bus, BusCreate, BusUpdate } from './bus.types';

/** A single page of rows plus the unbounded total, for building pagination meta. */
export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** DI token bound to the concrete {@link BusesRepository} implementation. */
export const BUSES_REPOSITORY = Symbol('BUSES_REPOSITORY');

/**
 * Persistence port for buses.
 *
 * Buses are company-scoped (no branch column). Every method takes `companyId`
 * explicitly and scopes its SQL by it, so a bus id alone is never sufficient to
 * read or mutate a record; soft-deleted rows are excluded everywhere. Driver
 * errors (unique plate, missing seat-layout FK) propagate as the shared
 * database exceptions and are mapped to `409` by the error mapper.
 */
export interface BusesRepository {
  /** A page of the company's buses (active or not, excluding soft-deleted). */
  listByCompany(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Bus>>;

  /** A single bus addressed within one company, or `null` if not there. */
  findInCompany(companyId: string, busId: string): Promise<Bus | null>;

  /** Insert a bus for the company. */
  create(companyId: string, input: BusCreate): Promise<Bus>;

  /**
   * Update a bus's fields within the company, incrementing its `version`.
   * Returns the new state, or `null` when no matching (non-deleted) bus exists.
   */
  update(
    companyId: string,
    busId: string,
    input: BusUpdate,
  ): Promise<Bus | null>;

  /**
   * Atomically flip `is_active` to `target` only when the record currently
   * holds the opposite value. Returns the updated record, or `null` when no row
   * transitioned (missing, or already in the target state).
   */
  transitionActive(
    companyId: string,
    busId: string,
    target: boolean,
  ): Promise<Bus | null>;
}
