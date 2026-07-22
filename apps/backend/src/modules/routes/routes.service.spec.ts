import type { DatabaseService, TransactionManager } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { resolvePagination } from '../../common/pagination/pagination';
import { ValidationException } from '../../common/validation/validation.exception';
import type { StationsRepository } from '../stations/stations.repository';
import type { Station } from '../stations/station.types';
import {
  RouteNotFoundError,
  RouteStateConflictError,
  RouteStationInvalidError,
} from './route.errors';
import type { RoutePricesRepository } from './route-prices.repository';
import type { RoutePrice, RoutePriceCreate } from './route-price.types';
import type { PagedResult, RoutesRepository } from './routes.repository';
import type { Route, RouteCreate, RouteUpdate } from './route.types';
import { RoutesService } from './routes.service';

function makeRoute(overrides: Partial<Route> = {}): Route {
  return {
    id: '9',
    companyId: '10',
    originStationId: '1',
    destinationStationId: '2',
    defaultPriceMru: 500,
    currency: 'MRU',
    estimatedDurationMinutes: 300,
    distanceKm: 0,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

class FakeRoutesRepository implements RoutesRepository {
  routes: Route[] = [];
  transitionResult: Route | null = null;

  listByCompany(
    _e: DatabaseExecutor,
    companyId: string,
  ): Promise<PagedResult<Route>> {
    const items = this.routes.filter((r) => r.companyId === companyId);
    return Promise.resolve({ items, total: items.length });
  }
  findInCompany(
    _e: DatabaseExecutor,
    companyId: string,
    routeId: string,
  ): Promise<Route | null> {
    return Promise.resolve(
      this.routes.find((r) => r.id === routeId && r.companyId === companyId) ??
        null,
    );
  }
  create(
    _e: DatabaseExecutor,
    companyId: string,
    input: RouteCreate,
  ): Promise<Route> {
    return Promise.resolve(makeRoute({ companyId, ...input }));
  }
  update(
    _e: DatabaseExecutor,
    companyId: string,
    routeId: string,
    input: RouteUpdate,
  ): Promise<Route | null> {
    const route = this.routes.find(
      (r) => r.id === routeId && r.companyId === companyId,
    );
    return Promise.resolve(route ? makeRoute({ ...route, ...input }) : null);
  }
  updateDefaultPrice(): Promise<Route | null> {
    return Promise.resolve(makeRoute());
  }
  transitionActive(): Promise<Route | null> {
    return Promise.resolve(this.transitionResult);
  }
}

class FakeRoutePricesRepository implements RoutePricesRepository {
  opened: RoutePriceCreate[] = [];
  listHistoryByRoute(): Promise<PagedResult<RoutePrice>> {
    return Promise.resolve({ items: [], total: 0 });
  }
  openInitialPeriod(
    _e: DatabaseExecutor,
    routeId: string,
    input: RoutePriceCreate,
  ): Promise<RoutePrice> {
    this.opened.push(input);
    return Promise.resolve({
      id: '1',
      routeId,
      priceMru: input.priceMru,
      currency: input.currency,
      effectiveFrom: new Date(),
      createdAt: new Date(),
    });
  }
  recordNewPeriod(
    _e: DatabaseExecutor,
    routeId: string,
    input: RoutePriceCreate,
  ): Promise<RoutePrice> {
    this.opened.push(input);
    return Promise.resolve({
      id: '2',
      routeId,
      priceMru: input.priceMru,
      currency: input.currency,
      effectiveFrom: new Date(),
      createdAt: new Date(),
    });
  }
}

class FakeStationsRepository implements StationsRepository {
  activeIds = new Set<string>(['1', '2']);
  listActive(): Promise<PagedResult<Station>> {
    return Promise.resolve({ items: [], total: 0 });
  }
  findActiveById(stationId: string): Promise<Station | null> {
    if (!this.activeIds.has(stationId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      id: stationId,
      cityId: '1',
      nameAr: 'x',
      nameFr: 'y',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

/** Runs the callback immediately with a throwaway executor (no real transaction). */
const fakeTransactions = {
  run: <T>(work: (tx: DatabaseExecutor) => Promise<T>): Promise<T> =>
    work({} as DatabaseExecutor),
} as unknown as TransactionManager;

const fakeDb = {} as DatabaseService;

describe('RoutesService', () => {
  let routesRepo: FakeRoutesRepository;
  let pricesRepo: FakeRoutePricesRepository;
  let stationsRepo: FakeStationsRepository;
  let service: RoutesService;

  beforeEach(() => {
    routesRepo = new FakeRoutesRepository();
    pricesRepo = new FakeRoutePricesRepository();
    stationsRepo = new FakeStationsRepository();
    service = new RoutesService(
      routesRepo,
      pricesRepo,
      stationsRepo,
      fakeDb,
      fakeTransactions,
    );
  });

  it('returns an empty page for a malformed company id', async () => {
    expect(await service.listRoutes('bad', resolvePagination())).toEqual({
      items: [],
      total: 0,
    });
  });

  it('404s a route addressed under the wrong company', async () => {
    routesRepo.routes.push(makeRoute({ id: '9', companyId: '10' }));
    await expect(service.getRoute('20', '9')).rejects.toBeInstanceOf(
      RouteNotFoundError,
    );
  });

  it('rejects an empty update with a validation error', async () => {
    await expect(service.updateRoute('10', '9', {})).rejects.toBeInstanceOf(
      ValidationException,
    );
  });

  it('rejects a create whose origin equals its destination (422)', async () => {
    await expect(
      service.createRoute('10', {
        originStationId: '1',
        destinationStationId: '1',
        defaultPriceMru: 500,
        currency: 'MRU',
        estimatedDurationMinutes: 300,
      }),
    ).rejects.toBeInstanceOf(RouteStationInvalidError);
  });

  it('rejects a create referencing an inactive/unknown station (422)', async () => {
    await expect(
      service.createRoute('10', {
        originStationId: '1',
        destinationStationId: '999',
        defaultPriceMru: 500,
        currency: 'MRU',
        estimatedDurationMinutes: 300,
      }),
    ).rejects.toBeInstanceOf(RouteStationInvalidError);
  });

  it('creates a route and seeds its initial open price period', async () => {
    const route = await service.createRoute('10', {
      originStationId: '1',
      destinationStationId: '2',
      defaultPriceMru: 500,
      currency: 'MRU',
      estimatedDurationMinutes: 300,
    });
    expect(route.companyId).toBe('10');
    expect(pricesRepo.opened).toEqual([
      { priceMru: 500, currency: 'MRU', changeReason: 'Initial price' },
    ]);
  });

  it('reports a redundant activation as conflict, a missing route as not-found', async () => {
    routesRepo.routes.push(makeRoute({ id: '9', companyId: '10', isActive: true }));
    routesRepo.transitionResult = null;
    await expect(service.setRouteActive('10', '9', true)).rejects.toBeInstanceOf(
      RouteStateConflictError,
    );
    await expect(service.setRouteActive('10', '404', true)).rejects.toBeInstanceOf(
      RouteNotFoundError,
    );
  });
});
