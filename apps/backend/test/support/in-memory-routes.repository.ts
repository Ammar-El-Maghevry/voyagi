import type { ResolvedPagination } from '../../src/common/pagination/pagination';
import type { DatabaseExecutor } from '../../src/infrastructure/database/database.types';
import { UniqueConstraintViolationError } from '../../src/infrastructure/database/database.errors';
import type {
  PagedResult,
  RoutesRepository,
} from '../../src/modules/routes/routes.repository';
import type {
  Route,
  RouteCreate,
  RouteUpdate,
} from '../../src/modules/routes/route.types';

/**
 * In-memory {@link RoutesRepository} for e2e tests. Preserves the SQL adapter's
 * observable semantics — company scoping and the composite unique constraint on
 * (company, origin, destination) — without a real database. The executor
 * argument is ignored (there is no transaction to honor in memory).
 */
export class InMemoryRoutesRepository implements RoutesRepository {
  private readonly routes: Route[] = [];
  private sequence = 3000;
  private failWith: Error | null = null;

  failNextWith(error: Error): void {
    this.failWith = error;
  }

  private maybeFail(): void {
    if (this.failWith) {
      const error = this.failWith;
      this.failWith = null;
      throw error;
    }
  }

  private duplicate(companyId: string, origin: string, destination: string, exceptId?: string): boolean {
    return this.routes.some(
      (r) =>
        r.companyId === companyId &&
        r.originStationId === origin &&
        r.destinationStationId === destination &&
        r.id !== exceptId,
    );
  }

  listByCompany(
    _e: DatabaseExecutor,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Route>> {
    this.maybeFail();
    const all = this.routes.filter((r) => r.companyId === companyId);
    return Promise.resolve({
      items: all.slice(pagination.offset, pagination.offset + pagination.limit),
      total: all.length,
    });
  }

  findInCompany(
    _e: DatabaseExecutor,
    companyId: string,
    routeId: string,
  ): Promise<Route | null> {
    this.maybeFail();
    return Promise.resolve(
      this.routes.find((r) => r.id === routeId && r.companyId === companyId) ?? null,
    );
  }

  create(
    _e: DatabaseExecutor,
    companyId: string,
    input: RouteCreate,
  ): Promise<Route> {
    this.maybeFail();
    if (this.duplicate(companyId, input.originStationId, input.destinationStationId)) {
      throw new UniqueConstraintViolationError();
    }
    const now = new Date();
    const route: Route = {
      id: String(++this.sequence),
      companyId,
      originStationId: input.originStationId,
      destinationStationId: input.destinationStationId,
      defaultPriceMru: input.defaultPriceMru,
      currency: input.currency,
      estimatedDurationMinutes: input.estimatedDurationMinutes,
      distanceKm: input.distanceKm ?? 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    this.routes.push(route);
    return Promise.resolve(route);
  }

  update(
    _e: DatabaseExecutor,
    companyId: string,
    routeId: string,
    input: RouteUpdate,
  ): Promise<Route | null> {
    this.maybeFail();
    const index = this.routes.findIndex((r) => r.id === routeId && r.companyId === companyId);
    if (index === -1) return Promise.resolve(null);
    const current = this.routes[index];
    const next: Route = {
      ...current,
      originStationId: input.originStationId ?? current.originStationId,
      destinationStationId: input.destinationStationId ?? current.destinationStationId,
      estimatedDurationMinutes: input.estimatedDurationMinutes ?? current.estimatedDurationMinutes,
      distanceKm: input.distanceKm ?? current.distanceKm,
      updatedAt: new Date(),
    };
    this.routes[index] = next;
    return Promise.resolve(next);
  }

  updateDefaultPrice(
    _e: DatabaseExecutor,
    companyId: string,
    routeId: string,
    priceMru: number,
    currency: string,
  ): Promise<Route | null> {
    this.maybeFail();
    const index = this.routes.findIndex((r) => r.id === routeId && r.companyId === companyId);
    if (index === -1) return Promise.resolve(null);
    const next: Route = { ...this.routes[index], defaultPriceMru: priceMru, currency, updatedAt: new Date() };
    this.routes[index] = next;
    return Promise.resolve(next);
  }

  transitionActive(
    _e: DatabaseExecutor,
    companyId: string,
    routeId: string,
    target: boolean,
  ): Promise<Route | null> {
    this.maybeFail();
    const index = this.routes.findIndex(
      (r) => r.id === routeId && r.companyId === companyId && r.isActive === !target,
    );
    if (index === -1) return Promise.resolve(null);
    const next: Route = { ...this.routes[index], isActive: target, updatedAt: new Date() };
    this.routes[index] = next;
    return Promise.resolve(next);
  }
}
