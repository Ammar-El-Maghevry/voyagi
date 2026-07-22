import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { SeatLayout } from './seat-layout.types';

/** A single page of rows plus the unbounded total, for building pagination meta. */
export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** DI token bound to the concrete {@link SeatLayoutsRepository} implementation. */
export const SEAT_LAYOUTS_REPOSITORY = Symbol('SEAT_LAYOUTS_REPOSITORY');

/**
 * Persistence port for seat layouts.
 *
 * Seat layouts are global templates (no tenant scope, readable by any
 * authenticated user per RLS `seat_layouts_read`). There are no write methods:
 * template management is not part of this phase.
 */
export interface SeatLayoutsRepository {
  /** A page of seat layouts, in a stable order. */
  listAll(pagination: ResolvedPagination): Promise<PagedResult<SeatLayout>>;

  /** A single seat layout by id, or `null` when absent. */
  findById(seatLayoutId: string): Promise<SeatLayout | null>;
}
