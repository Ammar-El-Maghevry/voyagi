import type { BusStatus } from './bus-status';

/**
 * A bus (`public.buses`) — a company-owned fleet vehicle. Company-scoped (there
 * is no branch column). Capacity is not stored on the bus; it is defined by the
 * referenced seat layout (`seatLayoutId` → `seat_layouts.total_seats`).
 * Soft-deleted rows are never surfaced.
 */
export interface Bus {
  readonly id: string;
  readonly companyId: string;
  readonly seatLayoutId: string;
  readonly plateNumber: string;
  readonly busModel?: string;
  readonly status: BusStatus;
  readonly isActive: boolean;
  readonly currentOdometerKm: number;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Fields required to create a bus. `companyId` comes from the tenant context;
 * `status` defaults to `ACTIVE`, `isActive` to true, and `version` to 1 (all
 * database defaults). `currentOdometerKm` defaults to 0 when omitted.
 */
export interface BusCreate {
  readonly seatLayoutId: string;
  readonly plateNumber: string;
  readonly busModel?: string;
  readonly currentOdometerKm?: number;
}

/**
 * Mutable fields of a bus. `status` and `isActive` are excluded: status is
 * maintenance-driven (deferred) and activation is a dedicated transition, never
 * a generic PATCH field. A `busModel` of `null` clears the stored model. Only a
 * non-negative `currentOdometerKm` is accepted; no monotonic (non-decreasing)
 * rule is documented, so none is enforced here.
 */
export interface BusUpdate {
  readonly seatLayoutId?: string;
  readonly plateNumber?: string;
  readonly busModel?: string | null;
  readonly currentOdometerKm?: number;
}
