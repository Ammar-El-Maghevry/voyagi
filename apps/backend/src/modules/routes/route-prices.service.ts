import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { DatabaseService } from '../../infrastructure/database';
import { TransactionManager } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { parsePositiveBigInt } from '../identity/identifier.util';
import { RouteNotFoundError } from './route.errors';
import type { RoutePrice, RoutePriceCreate } from './route-price.types';
import {
  ROUTE_PRICES_REPOSITORY,
  type RoutePricesRepository,
} from './route-prices.repository';
import {
  ROUTES_REPOSITORY,
  type PagedResult,
  type RoutesRepository,
} from './routes.repository';

/**
 * Application service for route pricing (append-only history).
 *
 * A price change is one transaction: verify the route belongs to the company,
 * close the current open period, open a new period, and mirror the new price
 * onto the route's `default_price_mru` — never a destructive overwrite of a
 * historical row. Reads require `routes.read`; the change requires
 * `routes.manage` (there is no dedicated pricing permission). Route ownership is
 * always checked first, since the history table itself has no `company_id`.
 */
@Injectable()
export class RoutePricesService {
  constructor(
    @Inject(ROUTE_PRICES_REPOSITORY)
    private readonly prices: RoutePricesRepository,
    @Inject(ROUTES_REPOSITORY)
    private readonly routes: RoutesRepository,
    private readonly db: DatabaseService,
    private readonly transactions: TransactionManager,
  ) {}

  /** A page of a route's price history (newest period first). */
  async listPriceHistory(
    companyId: string,
    routeId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<RoutePrice>> {
    const { normalizedCompanyId, normalizedRouteId } = this.normalizeIds(
      companyId,
      routeId,
    );
    await this.assertRouteInCompany(
      this.db,
      normalizedCompanyId,
      normalizedRouteId,
    );
    return this.prices.listHistoryByRoute(
      this.db,
      normalizedRouteId,
      pagination,
    );
  }

  /**
   * Record a new price for the route. Closes the open period and opens a new one
   * atomically; the gist exclusion constraint / partial unique index reject any
   * overlap or a concurrent second open period (`409`).
   */
  async createPrice(
    companyId: string,
    routeId: string,
    input: RoutePriceCreate,
  ): Promise<RoutePrice> {
    const { normalizedCompanyId, normalizedRouteId } = this.normalizeIds(
      companyId,
      routeId,
    );

    return this.transactions.run(async (tx) => {
      await this.assertRouteInCompany(tx, normalizedCompanyId, normalizedRouteId);
      // Close the open period and open the new one atomically at one boundary.
      const period = await this.prices.recordNewPeriod(tx, normalizedRouteId, input);
      // Mirror the current price onto the route in the same transaction — if this
      // fails, the history change above rolls back with it.
      await this.routes.updateDefaultPrice(
        tx,
        normalizedCompanyId,
        normalizedRouteId,
        input.priceMru,
        input.currency,
      );
      return period;
    });
  }

  private normalizeIds(
    companyId: string,
    routeId: string,
  ): { normalizedCompanyId: string; normalizedRouteId: string } {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    const normalizedRouteId = parsePositiveBigInt(routeId);
    if (normalizedCompanyId === null || normalizedRouteId === null) {
      throw new RouteNotFoundError();
    }
    return { normalizedCompanyId, normalizedRouteId };
  }

  private async assertRouteInCompany(
    executor: DatabaseExecutor,
    companyId: string,
    routeId: string,
  ): Promise<void> {
    const route = await this.routes.findInCompany(executor, companyId, routeId);
    if (!route) {
      throw new RouteNotFoundError();
    }
  }
}
