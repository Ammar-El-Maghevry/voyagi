/**
 * A route (`public.routes`) — a company-owned origin→destination definition
 * over two global stations. Company-scoped (composite unique `(id, company_id)`).
 * `defaultPriceMru`/`currency` are the route's current price (snapshotted onto
 * trips at creation and mirrored into the append-only price history).
 * Soft-deleted rows are never surfaced.
 */
export interface Route {
  readonly id: string;
  readonly companyId: string;
  readonly originStationId: string;
  readonly destinationStationId: string;
  readonly defaultPriceMru: number;
  readonly currency: string;
  readonly estimatedDurationMinutes: number;
  readonly distanceKm: number;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Fields required to create a route. `companyId` comes from the tenant context.
 * `isActive` defaults to true; the initial price also seeds the price history.
 */
export interface RouteCreate {
  readonly originStationId: string;
  readonly destinationStationId: string;
  readonly defaultPriceMru: number;
  readonly currency: string;
  readonly estimatedDurationMinutes: number;
  readonly distanceKm?: number;
}

/**
 * Mutable descriptive fields of a route. `isActive` is excluded (dedicated
 * transition) and `defaultPriceMru` is excluded (changed only through the
 * append-only pricing flow, never a generic PATCH).
 */
export interface RouteUpdate {
  readonly originStationId?: string;
  readonly destinationStationId?: string;
  readonly estimatedDurationMinutes?: number;
  readonly distanceKm?: number;
}
