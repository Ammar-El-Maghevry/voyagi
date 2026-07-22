import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import type { Route, RouteCreate, RouteUpdate } from './route.types';

/** A single page of rows plus the unbounded total, for building pagination meta. */
export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** DI token bound to the concrete {@link RoutesRepository} implementation. */
export const ROUTES_REPOSITORY = Symbol('ROUTES_REPOSITORY');

/**
 * Persistence port for routes.
 *
 * Routes are company-scoped. Every method takes `companyId` explicitly and
 * scopes its SQL by it, so a route id alone is never sufficient; soft-deleted
 * rows are excluded everywhere. Each method takes a {@link DatabaseExecutor} so
 * the caller runs it either on the ambient pool or inside a transaction (route
 * creation and price changes span several statements atomically).
 */
export interface RoutesRepository {
  /** A page of the company's routes (active or not, excluding soft-deleted). */
  listByCompany(
    executor: DatabaseExecutor,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Route>>;

  /** A single route addressed within one company, or `null` if not there. */
  findInCompany(
    executor: DatabaseExecutor,
    companyId: string,
    routeId: string,
  ): Promise<Route | null>;

  /** Insert a route for the company. */
  create(
    executor: DatabaseExecutor,
    companyId: string,
    input: RouteCreate,
  ): Promise<Route>;

  /** Update a route's descriptive fields within the company, or `null` if absent. */
  update(
    executor: DatabaseExecutor,
    companyId: string,
    routeId: string,
    input: RouteUpdate,
  ): Promise<Route | null>;

  /**
   * Update the route's current default price/currency within the company (used
   * by the pricing flow, in the same transaction as the history append). Returns
   * the updated route, or `null` when no matching route exists.
   */
  updateDefaultPrice(
    executor: DatabaseExecutor,
    companyId: string,
    routeId: string,
    priceMru: number,
    currency: string,
  ): Promise<Route | null>;

  /**
   * Atomically flip `is_active` to `target` only when the record currently holds
   * the opposite value. Returns the updated record, or `null` when no row
   * transitioned (missing, or already in the target state).
   */
  transitionActive(
    executor: DatabaseExecutor,
    companyId: string,
    routeId: string,
    target: boolean,
  ): Promise<Route | null>;
}
