/**
 * A route price period (`public.route_price_history`) — one immutable row in a
 * route's append-only pricing history. Exactly one period is open at a time
 * (`effectiveTo === undefined`), enforced by a partial unique index; periods
 * never overlap, enforced by a gist exclusion constraint. The table has no
 * `company_id`; ownership is via the parent route (verified before any access).
 */
export interface RoutePrice {
  readonly id: string;
  readonly routeId: string;
  readonly priceMru: number;
  readonly currency: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly changeReason?: string;
  readonly changedByUserId?: string;
  readonly createdAt: Date;
}

/**
 * Fields required to open a new price period. `routeId` and the closing of the
 * prior open period are handled by the pricing flow within one transaction.
 */
export interface RoutePriceCreate {
  readonly priceMru: number;
  readonly currency: string;
  readonly changeReason?: string;
  readonly changedByUserId?: string;
}
