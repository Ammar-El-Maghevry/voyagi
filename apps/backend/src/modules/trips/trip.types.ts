import type { TripStatus } from './trip-status';

/**
 * A trip (`public.trips`) — a company-owned scheduled run of a bus over a route.
 * Company-scoped (there is no branch column). `priceMru`/`currency` are
 * snapshotted from the route at creation, so later route price changes never
 * alter a scheduled trip. `boardingClosesAt` is server-computed from company
 * settings. Actual departure/arrival times are server-controlled by the
 * lifecycle actions. Soft-deleted/inactive handling follows `is_active`.
 */
export interface Trip {
  readonly id: string;
  readonly companyId: string;
  readonly routeId: string;
  readonly busId: string;
  readonly driverId?: string;
  readonly assistantId?: string;
  readonly departureTime: Date;
  readonly estimatedArrivalTime: Date;
  readonly actualDepartureTime?: Date;
  readonly actualArrivalTime?: Date;
  readonly boardingClosesAt: Date;
  readonly priceMru: number;
  readonly currency: string;
  readonly status: TripStatus;
  readonly isActive: boolean;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Client-supplied fields to schedule a trip. `companyId` comes from the tenant
 * path; price/currency/boarding time and status are server-derived, never taken
 * from the request.
 */
export interface TripCreate {
  readonly routeId: string;
  readonly busId: string;
  readonly driverId?: string;
  readonly assistantId?: string;
  readonly departureTime: Date;
  readonly estimatedArrivalTime: Date;
}

/** Fully-resolved insert payload (price/currency/boarding time computed server-side). */
export interface TripInsert extends TripCreate {
  readonly boardingClosesAt: Date;
  readonly priceMru: number;
  readonly currency: string;
}

/**
 * Editable trip fields (only while `SCHEDULED`). Status and actual times are
 * never edited here — status changes go through the lifecycle actions and actual
 * times are server-controlled. A `null` driver/assistant clears the assignment.
 * `boardingClosesAt` is recomputed by the service whenever `departureTime` moves.
 */
export interface TripUpdate {
  readonly departureTime?: Date;
  readonly estimatedArrivalTime?: Date;
  readonly driverId?: string | null;
  readonly assistantId?: string | null;
}
