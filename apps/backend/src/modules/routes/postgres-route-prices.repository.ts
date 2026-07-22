import { Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import {
  ROUTE_PRICE_COLUMNS,
  type RoutePriceRow,
  toRoutePrice,
} from './route-price.mapper';
import type { RoutePricesRepository } from './route-prices.repository';
import type { RoutePrice, RoutePriceCreate } from './route-price.types';
import type { PagedResult } from './routes.repository';

/**
 * PostgreSQL adapter for route price history. Every statement is parameterized
 * and selects explicit columns, scoped by `route_id` (the caller verifies the
 * route's company ownership first). Historical rows are never updated except to
 * close the open period's `effective_to`; new prices are always inserted.
 */
@Injectable()
export class PostgresRoutePricesRepository implements RoutePricesRepository {
  async listHistoryByRoute(
    executor: DatabaseExecutor,
    routeId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<RoutePrice>> {
    const rows = await executor.query<RoutePriceRow>(
      `SELECT ${ROUTE_PRICE_COLUMNS}
         FROM public.route_price_history
         WHERE route_id = $1
         ORDER BY effective_from DESC, id DESC
         LIMIT $2 OFFSET $3`,
      [routeId, pagination.limit, pagination.offset],
      { name: 'route_prices.list_history' },
    );
    const total = await this.count(
      executor,
      `SELECT count(*)::text AS total
         FROM public.route_price_history
         WHERE route_id = $1`,
      [routeId],
      'route_prices.count_history',
    );
    return { items: rows.rows.map(toRoutePrice), total };
  }

  async openInitialPeriod(
    executor: DatabaseExecutor,
    routeId: string,
    input: RoutePriceCreate,
  ): Promise<RoutePrice> {
    // First period: `effective_from` takes the `now()` column default (the
    // transaction start). A later change's boundary is a `clock_timestamp()`,
    // which is strictly after this, so `effective_to > effective_from` holds.
    const result = await executor.query<RoutePriceRow>(
      `INSERT INTO public.route_price_history
         (route_id, price_mru, currency, change_reason, changed_by_user_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${ROUTE_PRICE_COLUMNS}`,
      [
        routeId,
        input.priceMru,
        input.currency,
        input.changeReason ?? null,
        input.changedByUserId ?? null,
      ],
      { name: 'route_prices.open_initial_period' },
    );
    return toRoutePrice(result.rows[0]);
  }

  async recordNewPeriod(
    executor: DatabaseExecutor,
    routeId: string,
    input: RoutePriceCreate,
  ): Promise<RoutePrice> {
    // One boundary for both operations. Closing the open period stamps
    // `effective_to = clock_timestamp()` and returns that exact instant (as text,
    // to preserve sub-millisecond precision across the round trip). The new
    // period then opens `effective_from` from that same instant, so
    // `old.effective_to === new.effective_from` — no gap, no overlap.
    //
    // This is two statements, not a single data-modifying CTE: a CTE's INSERT
    // would not see the sibling UPDATE's effect (same snapshot), so the still-
    // open old period would spuriously trip the exclusion constraint. Running the
    // close first means the new row is checked against the already-closed period.
    const closed = await executor.query<{ at: string }>(
      `UPDATE public.route_price_history
         SET effective_to = clock_timestamp()
         WHERE route_id = $1 AND effective_to IS NULL
         RETURNING effective_to::text AS at`,
      [routeId],
      { name: 'route_prices.close_open_period' },
    );
    const boundary = closed.rows[0]?.at ?? null;

    // `COALESCE(..., clock_timestamp())` covers the (defensive) case of no prior
    // open period; normally the returned boundary is used so the periods abut.
    const result = await executor.query<RoutePriceRow>(
      `INSERT INTO public.route_price_history
         (route_id, price_mru, currency, change_reason, changed_by_user_id, effective_from)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, clock_timestamp()))
         RETURNING ${ROUTE_PRICE_COLUMNS}`,
      [
        routeId,
        input.priceMru,
        input.currency,
        input.changeReason ?? null,
        input.changedByUserId ?? null,
        boundary,
      ],
      { name: 'route_prices.open_period' },
    );
    return toRoutePrice(result.rows[0]);
  }

  private async count(
    executor: DatabaseExecutor,
    text: string,
    params: readonly unknown[],
    name: string,
  ): Promise<number> {
    const result = await executor.query<{ total: string }>(text, params, {
      name,
    });
    return Number(result.rows[0]?.total ?? 0);
  }
}
