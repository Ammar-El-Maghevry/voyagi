import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import type { PagedResult } from './routes.repository';
import type { RoutePrice, RoutePriceCreate } from './route-price.types';

/** DI token bound to the concrete {@link RoutePricesRepository} implementation. */
export const ROUTE_PRICES_REPOSITORY = Symbol('ROUTE_PRICES_REPOSITORY');

/**
 * Persistence port for the append-only route price history.
 *
 * The table has no `company_id`, so callers MUST verify the parent route belongs
 * to the tenant company (via the routes repository) before invoking any method
 * here. Historical rows are immutable except for closing the single open
 * period's `effective_to`; a new price is always a fresh row (never a
 * destructive overwrite). Each method takes a {@link DatabaseExecutor} so a price
 * change runs entirely inside one transaction.
 */
export interface RoutePricesRepository {
  /** A page of a route's price periods, newest effective period first. */
  listHistoryByRoute(
    executor: DatabaseExecutor,
    routeId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<RoutePrice>>;

  /**
   * Open the route's very first price period (`effective_to = null`). Used once,
   * inside route creation, when there is no prior period to close.
   */
  openInitialPeriod(
    executor: DatabaseExecutor,
    routeId: string,
    input: RoutePriceCreate,
  ): Promise<RoutePrice>;

  /**
   * Record a price change as one statement: capture a single boundary timestamp,
   * close the current open period at it, and open the new period *from that exact
   * same instant* — so `old.effective_to === new.effective_from` (no gap, no
   * overlap). The gist exclusion constraint and partial-unique index reject any
   * overlap or a concurrent second open period (→ `409`). Returns the new period.
   */
  recordNewPeriod(
    executor: DatabaseExecutor,
    routeId: string,
    input: RoutePriceCreate,
  ): Promise<RoutePrice>;
}
