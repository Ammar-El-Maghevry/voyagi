import type { RoutePrice } from './route-price.types';

/** Raw `route_price_history` row (bigint/numeric columns arrive as strings). */
export interface RoutePriceRow {
  id: string;
  route_id: string;
  price_mru: string;
  currency: string;
  effective_from: Date;
  effective_to: Date | null;
  change_reason: string | null;
  changed_by_user_id: string | null;
  created_at: Date;
}

/** Explicit, non-`SELECT *` column list (aligned with {@link RoutePriceRow}). */
export const ROUTE_PRICE_COLUMNS =
  'id, route_id, price_mru, currency, effective_from, effective_to, change_reason, changed_by_user_id, created_at';

export function toRoutePrice(row: RoutePriceRow): RoutePrice {
  return {
    id: row.id,
    routeId: row.route_id,
    priceMru: Number(row.price_mru),
    currency: row.currency,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to === null ? undefined : row.effective_to,
    changeReason: row.change_reason === null ? undefined : row.change_reason,
    changedByUserId:
      row.changed_by_user_id === null ? undefined : row.changed_by_user_id,
    createdAt: row.created_at,
  };
}
