import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { ValidationException } from '../../common/validation/validation.exception';
import { DatabaseService } from '../../infrastructure/database';
import { TransactionManager } from '../../infrastructure/database';
import { parsePositiveBigInt } from '../identity/identifier.util';
import {
  STATIONS_REPOSITORY,
  type StationsRepository,
} from '../stations/stations.repository';
import {
  RouteNotFoundError,
  RouteStateConflictError,
  RouteStationInvalidError,
} from './route.errors';
import type { Route, RouteCreate, RouteUpdate } from './route.types';
import {
  ROUTE_PRICES_REPOSITORY,
  type RoutePricesRepository,
} from './route-prices.repository';
import {
  ROUTES_REPOSITORY,
  type PagedResult,
  type RoutesRepository,
} from './routes.repository';

const EMPTY_PAGE: PagedResult<Route> = { items: [], total: 0 };

/**
 * Application service for routes.
 *
 * Routes are company-scoped: `routes.read` (any active member) governs reads and
 * the company-wide `routes.manage` governs writes, both enforced by the guard.
 * Creation is transactional — the route row plus the initial open price period
 * are written atomically, so every route always has a price-history baseline
 * (matching the seed convention). Ids are validated before any query so a
 * malformed value fails closed (`404`) instead of reaching the database as a
 * `22P02` → `500`.
 */
@Injectable()
export class RoutesService {
  constructor(
    @Inject(ROUTES_REPOSITORY)
    private readonly routes: RoutesRepository,
    @Inject(ROUTE_PRICES_REPOSITORY)
    private readonly prices: RoutePricesRepository,
    @Inject(STATIONS_REPOSITORY)
    private readonly stations: StationsRepository,
    private readonly db: DatabaseService,
    private readonly transactions: TransactionManager,
  ) {}

  /** A page of the company's routes. */
  async listRoutes(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Route>> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    if (normalizedCompanyId === null) {
      return EMPTY_PAGE;
    }
    return this.routes.listByCompany(this.db, normalizedCompanyId, pagination);
  }

  /** A single route within the company, or {@link RouteNotFoundError}. */
  async getRoute(companyId: string, routeId: string): Promise<Route> {
    const route = await this.findOr404(companyId, routeId);
    return route;
  }

  /**
   * Create a route (requires `routes.manage`, enforced upstream). Origin and
   * destination must be distinct, existing, active stations; the route and its
   * initial price period are inserted atomically.
   */
  async createRoute(companyId: string, input: RouteCreate): Promise<Route> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    if (normalizedCompanyId === null) {
      throw new RouteNotFoundError();
    }
    await this.assertDistinctActiveStations(
      input.originStationId,
      input.destinationStationId,
    );

    return this.transactions.run(async (tx) => {
      const route = await this.routes.create(tx, normalizedCompanyId, input);
      await this.prices.openInitialPeriod(tx, route.id, {
        priceMru: route.defaultPriceMru,
        currency: route.currency,
        changeReason: 'Initial price',
      });
      return route;
    });
  }

  /** Update a route's descriptive fields within the company. */
  async updateRoute(
    companyId: string,
    routeId: string,
    input: RouteUpdate,
  ): Promise<Route> {
    if (
      input.originStationId === undefined &&
      input.destinationStationId === undefined &&
      input.estimatedDurationMinutes === undefined &&
      input.distanceKm === undefined
    ) {
      throw new ValidationException({
        body: ['At least one updatable field must be provided.'],
      });
    }
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    const normalizedRouteId = parsePositiveBigInt(routeId);
    if (normalizedCompanyId === null || normalizedRouteId === null) {
      throw new RouteNotFoundError();
    }
    // Validate station changes against the active global catalog before writing.
    if (
      input.originStationId !== undefined ||
      input.destinationStationId !== undefined
    ) {
      const existing = await this.routes.findInCompany(
        this.db,
        normalizedCompanyId,
        normalizedRouteId,
      );
      if (!existing) {
        throw new RouteNotFoundError();
      }
      await this.assertDistinctActiveStations(
        input.originStationId ?? existing.originStationId,
        input.destinationStationId ?? existing.destinationStationId,
      );
    }
    const route = await this.routes.update(
      this.db,
      normalizedCompanyId,
      normalizedRouteId,
      input,
    );
    if (!route) {
      throw new RouteNotFoundError();
    }
    return route;
  }

  /** Activate or deactivate a route (atomic transition; no-op → conflict). */
  async setRouteActive(
    companyId: string,
    routeId: string,
    target: boolean,
  ): Promise<Route> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    const normalizedRouteId = parsePositiveBigInt(routeId);
    if (normalizedCompanyId === null || normalizedRouteId === null) {
      throw new RouteNotFoundError();
    }
    const transitioned = await this.routes.transitionActive(
      this.db,
      normalizedCompanyId,
      normalizedRouteId,
      target,
    );
    if (transitioned) {
      return transitioned;
    }
    const existing = await this.routes.findInCompany(
      this.db,
      normalizedCompanyId,
      normalizedRouteId,
    );
    if (existing) {
      throw new RouteStateConflictError(target);
    }
    throw new RouteNotFoundError();
  }

  private async findOr404(companyId: string, routeId: string): Promise<Route> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    const normalizedRouteId = parsePositiveBigInt(routeId);
    if (normalizedCompanyId === null || normalizedRouteId === null) {
      throw new RouteNotFoundError();
    }
    const route = await this.routes.findInCompany(
      this.db,
      normalizedCompanyId,
      normalizedRouteId,
    );
    if (!route) {
      throw new RouteNotFoundError();
    }
    return route;
  }

  /** Enforce origin ≠ destination and both being existing, active stations. */
  private async assertDistinctActiveStations(
    originStationId: string,
    destinationStationId: string,
  ): Promise<void> {
    if (originStationId === destinationStationId) {
      throw new RouteStationInvalidError();
    }
    const [origin, destination] = await Promise.all([
      this.stations.findActiveById(originStationId),
      this.stations.findActiveById(destinationStationId),
    ]);
    if (!origin || !destination) {
      throw new RouteStationInvalidError();
    }
  }
}
