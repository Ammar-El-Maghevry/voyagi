import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import type { TripStatus } from './trip-status';
import type { TripTimestampField } from './trip-transitions';
import type { Trip, TripInsert, TripUpdate } from './trip.types';

/** A single page of rows plus the unbounded total, for building pagination meta. */
export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** Minimal route facts needed to validate and price a trip at creation. */
export interface RouteAssignment {
  readonly isActive: boolean;
  readonly defaultPriceMru: number;
  readonly currency: string;
}

/** Minimal bus facts needed to validate a trip's vehicle at creation. */
export interface BusAssignment {
  readonly isActive: boolean;
  readonly status: string;
}

/** Minimal staff facts needed to validate a trip's driver/assistant. */
export interface StaffAssignment {
  readonly isActive: boolean;
  readonly staffType: string;
}

/** DI token bound to the concrete {@link TripsRepository} implementation. */
export const TRIPS_REPOSITORY = Symbol('TRIPS_REPOSITORY');

/**
 * Persistence port for trips.
 *
 * Trips are company-scoped (no branch column). Every method takes `companyId`
 * explicitly and scopes its SQL by it. The assignment/setting reads exist so a
 * trip's route/bus can be validated (and priced) inside the same creation
 * transaction — scoped joins rather than a global fetch plus an app-side compare.
 * Each method takes a {@link DatabaseExecutor} so lifecycle changes (which also
 * append a trip event) run atomically.
 */
export interface TripsRepository {
  /** A page of the company's trips, newest departure first. */
  listByCompany(
    executor: DatabaseExecutor,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Trip>>;

  /** A single trip addressed within one company, or `null` if not there. */
  findInCompany(
    executor: DatabaseExecutor,
    companyId: string,
    tripId: string,
  ): Promise<Trip | null>;

  /** Route facts scoped to the company (for validation/pricing), or `null`. */
  findRouteAssignment(
    executor: DatabaseExecutor,
    companyId: string,
    routeId: string,
  ): Promise<RouteAssignment | null>;

  /** Bus facts scoped to the company (for validation), or `null`. */
  findBusAssignment(
    executor: DatabaseExecutor,
    companyId: string,
    busId: string,
  ): Promise<BusAssignment | null>;

  /** Lock the company bus row before changing its schedule. */
  lockBusAssignment(
    executor: DatabaseExecutor,
    companyId: string,
    busId: string,
  ): Promise<BusAssignment | null>;

  /**
   * Staff facts scoped to the company, excluding soft-deleted rows (for
   * driver/assistant validation), or `null`. Excludes `deleted_at IS NOT NULL`,
   * which the database staff-type trigger does not, so a soft-deleted staff
   * member is rejected here even though the trigger alone would admit it.
   */
  findStaffAssignment(
    executor: DatabaseExecutor,
    companyId: string,
    staffId: string,
  ): Promise<StaffAssignment | null>;

  /** The company's boarding-close window in minutes (platform default when unset). */
  readBoardingCloseMinutes(
    executor: DatabaseExecutor,
    companyId: string,
  ): Promise<number>;

  /**
   * Insert a scheduled trip. The bus-overlap exclusion constraint, the time
   * check, the staff-type trigger, and the composite same-company foreign keys
   * enforce the invariants (mapped to 409/422 by the error mapper).
   */
  insert(
    executor: DatabaseExecutor,
    companyId: string,
    input: TripInsert,
  ): Promise<Trip>;

  /**
   * Version-aware edit of a still-`SCHEDULED` trip. Applies only when the row's
   * status is `SCHEDULED` and its `version` equals `expectedVersion`, bumping the
   * version. Returns the updated trip, or `null` when nothing matched (missing,
   * not schedulable, or a stale version — the caller disambiguates).
   */
  updateDetails(
    executor: DatabaseExecutor,
    companyId: string,
    tripId: string,
    expectedVersion: number,
    input: TripUpdate,
    boardingClosesAt: Date | null,
  ): Promise<Trip | null>;

  /**
   * Atomically move a trip from one of `from` to `to`, bumping the version and
   * optionally stamping a server-controlled actual time. Returns the updated
   * trip, or `null` when no row was in an allowed source status (missing or
   * wrong state — the caller disambiguates).
   */
  transition(
    executor: DatabaseExecutor,
    companyId: string,
    tripId: string,
    from: readonly TripStatus[],
    to: TripStatus,
    stamps: TripTimestampField,
  ): Promise<Trip | null>;
}
