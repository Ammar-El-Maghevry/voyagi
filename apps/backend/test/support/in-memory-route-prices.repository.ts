import type { ResolvedPagination } from '../../src/common/pagination/pagination';
import type { DatabaseExecutor } from '../../src/infrastructure/database/database.types';
import type { RoutePricesRepository } from '../../src/modules/routes/route-prices.repository';
import type {
  RoutePrice,
  RoutePriceCreate,
} from '../../src/modules/routes/route-price.types';
import type { PagedResult } from '../../src/modules/routes/routes.repository';

/**
 * In-memory {@link RoutePricesRepository} for e2e tests. Preserves the SQL
 * adapter's observable semantics — append-only periods with exactly one open
 * period per route — without a real database.
 */
export class InMemoryRoutePricesRepository implements RoutePricesRepository {
  private readonly periods: RoutePrice[] = [];
  private sequence = 8000;

  listHistoryByRoute(
    _e: DatabaseExecutor,
    routeId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<RoutePrice>> {
    const all = this.periods
      .filter((p) => p.routeId === routeId)
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
    return Promise.resolve({
      items: all.slice(pagination.offset, pagination.offset + pagination.limit),
      total: all.length,
    });
  }

  openInitialPeriod(
    _e: DatabaseExecutor,
    routeId: string,
    input: RoutePriceCreate,
  ): Promise<RoutePrice> {
    return this.open(routeId, input, new Date());
  }

  recordNewPeriod(
    _e: DatabaseExecutor,
    routeId: string,
    input: RoutePriceCreate,
  ): Promise<RoutePrice> {
    // One boundary for both close and open: old.effectiveTo === new.effectiveFrom.
    const at = new Date();
    for (const p of this.periods) {
      if (p.routeId === routeId && p.effectiveTo === undefined) {
        (p as { effectiveTo?: Date }).effectiveTo = at;
      }
    }
    return this.open(routeId, input, at);
  }

  private open(routeId: string, input: RoutePriceCreate, at: Date): Promise<RoutePrice> {
    const period: RoutePrice = {
      id: String(++this.sequence),
      routeId,
      priceMru: input.priceMru,
      currency: input.currency,
      effectiveFrom: at,
      effectiveTo: undefined,
      changeReason: input.changeReason,
      changedByUserId: input.changedByUserId,
      createdAt: new Date(),
    };
    this.periods.push(period);
    return Promise.resolve(period);
  }
}
