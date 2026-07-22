import { Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { ROUTE_COLUMNS, type RouteRow, toRoute } from './route.mapper';
import type { PagedResult, RoutesRepository } from './routes.repository';
import type { Route, RouteCreate, RouteUpdate } from './route.types';

/**
 * PostgreSQL adapter for routes. Every statement is parameterized, selects
 * explicit columns, scopes by `company_id`, and excludes soft-deleted rows. On
 * the backend's trusted (RLS-bypassing) connection, the `company_id` predicates
 * are the authoritative tenant boundary. Stateless w.r.t. the executor — each
 * method runs on the {@link DatabaseExecutor} it is handed (pool or transaction).
 */
@Injectable()
export class PostgresRoutesRepository implements RoutesRepository {
  async listByCompany(
    executor: DatabaseExecutor,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Route>> {
    const rows = await executor.query<RouteRow>(
      `SELECT ${ROUTE_COLUMNS}
         FROM public.routes
         WHERE company_id = $1 AND deleted_at IS NULL
         ORDER BY id
         LIMIT $2 OFFSET $3`,
      [companyId, pagination.limit, pagination.offset],
      { name: 'routes.list_for_company' },
    );
    const total = await this.count(
      executor,
      `SELECT count(*)::text AS total
         FROM public.routes
         WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId],
      'routes.count_for_company',
    );
    return { items: rows.rows.map(toRoute), total };
  }

  async findInCompany(
    executor: DatabaseExecutor,
    companyId: string,
    routeId: string,
  ): Promise<Route | null> {
    const result = await executor.query<RouteRow>(
      `SELECT ${ROUTE_COLUMNS}
         FROM public.routes
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [routeId, companyId],
      { name: 'routes.find_in_company' },
    );
    const row = result.rows[0];
    return row ? toRoute(row) : null;
  }

  async create(
    executor: DatabaseExecutor,
    companyId: string,
    input: RouteCreate,
  ): Promise<Route> {
    const result = await executor.query<RouteRow>(
      `INSERT INTO public.routes
         (company_id, origin_station_id, destination_station_id,
          default_price_mru, currency, estimated_duration_minutes, distance_km)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${ROUTE_COLUMNS}`,
      [
        companyId,
        input.originStationId,
        input.destinationStationId,
        input.defaultPriceMru,
        input.currency,
        input.estimatedDurationMinutes,
        input.distanceKm ?? 0,
      ],
      { name: 'routes.insert' },
    );
    return toRoute(result.rows[0]);
  }

  async update(
    executor: DatabaseExecutor,
    companyId: string,
    routeId: string,
    input: RouteUpdate,
  ): Promise<Route | null> {
    const assignments: string[] = [];
    const params: unknown[] = [routeId, companyId];

    if (input.originStationId !== undefined) {
      params.push(input.originStationId);
      assignments.push(`origin_station_id = $${params.length}`);
    }
    if (input.destinationStationId !== undefined) {
      params.push(input.destinationStationId);
      assignments.push(`destination_station_id = $${params.length}`);
    }
    if (input.estimatedDurationMinutes !== undefined) {
      params.push(input.estimatedDurationMinutes);
      assignments.push(`estimated_duration_minutes = $${params.length}`);
    }
    if (input.distanceKm !== undefined) {
      params.push(input.distanceKm);
      assignments.push(`distance_km = $${params.length}`);
    }

    const result = await executor.query<RouteRow>(
      `UPDATE public.routes
         SET ${assignments.join(', ')}, updated_at = now()
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
         RETURNING ${ROUTE_COLUMNS}`,
      params,
      { name: 'routes.update' },
    );
    const row = result.rows[0];
    return row ? toRoute(row) : null;
  }

  async updateDefaultPrice(
    executor: DatabaseExecutor,
    companyId: string,
    routeId: string,
    priceMru: number,
    currency: string,
  ): Promise<Route | null> {
    const result = await executor.query<RouteRow>(
      `UPDATE public.routes
         SET default_price_mru = $3, currency = $4, updated_at = now()
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
         RETURNING ${ROUTE_COLUMNS}`,
      [routeId, companyId, priceMru, currency],
      { name: 'routes.update_default_price' },
    );
    const row = result.rows[0];
    return row ? toRoute(row) : null;
  }

  async transitionActive(
    executor: DatabaseExecutor,
    companyId: string,
    routeId: string,
    target: boolean,
  ): Promise<Route | null> {
    const result = await executor.query<RouteRow>(
      `UPDATE public.routes
         SET is_active = $3, updated_at = now()
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
           AND is_active = NOT $3
         RETURNING ${ROUTE_COLUMNS}`,
      [routeId, companyId, target],
      { name: 'routes.transition_active' },
    );
    const row = result.rows[0];
    return row ? toRoute(row) : null;
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
