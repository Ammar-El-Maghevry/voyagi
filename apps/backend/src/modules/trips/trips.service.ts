import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { ValidationException } from '../../common/validation/validation.exception';
import { DatabaseService, TransactionManager } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { parsePositiveBigInt } from '../identity/identifier.util';
import { BusStatus } from '../buses/bus-status';
import { StaffType } from '../staff/staff-type';
import {
  TripAssociationInvalidError,
  TripNotFoundError,
  TripTransitionConflictError,
  TripVersionConflictError,
} from './trip.errors';
import { TripStatus } from './trip-status';
import { TripEventSource, TripEventType } from './trip-event.types';
import { TRIP_TRANSITIONS, type TripAction } from './trip-transitions';
import {
  TRIP_EVENTS_REPOSITORY,
  type TripEventsRepository,
} from './trip-events.repository';
import {
  TRIPS_REPOSITORY,
  type PagedResult,
  type TripsRepository,
} from './trips.repository';
import type { Trip, TripCreate, TripUpdate } from './trip.types';

const EMPTY_PAGE: PagedResult<Trip> = { items: [], total: 0 };
const MS_PER_MINUTE = 60_000;

/**
 * Application service for trips.
 *
 * Trips are company-scoped: `trips.read` (any active member) governs reads and
 * the company-wide `trips.manage` governs writes, both enforced by the guard.
 * There is no branch dimension, so no branch-entitlement narrowing applies.
 *
 * Creation and every lifecycle change run in a transaction: the trip row and its
 * append-only event are written atomically, association/pricing reads are scoped
 * to the company, and the database enforces the hard invariants (same-company
 * foreign keys, non-overlapping bus schedule, valid times, active staff types).
 */
@Injectable()
export class TripsService {
  constructor(
    @Inject(TRIPS_REPOSITORY) private readonly trips: TripsRepository,
    @Inject(TRIP_EVENTS_REPOSITORY)
    private readonly events: TripEventsRepository,
    private readonly db: DatabaseService,
    private readonly transactions: TransactionManager,
  ) {}

  /** A page of the company's trips. */
  async listTrips(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Trip>> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    if (normalizedCompanyId === null) {
      return EMPTY_PAGE;
    }
    return this.trips.listByCompany(this.db, normalizedCompanyId, pagination);
  }

  /** A single trip within the company, or {@link TripNotFoundError}. */
  async getTrip(companyId: string, tripId: string): Promise<Trip> {
    const { companyId: c, tripId: t } = this.normalizeTripIds(companyId, tripId);
    const trip = await this.trips.findInCompany(this.db, c, t);
    if (!trip) {
      throw new TripNotFoundError();
    }
    return trip;
  }

  /**
   * Schedule a trip (requires `trips.manage`). Validates the route/bus within the
   * company, snapshots the route price, computes the boarding-close time, and
   * writes the trip plus a `TRIP_CREATED` event atomically.
   */
  async createTrip(
    companyId: string,
    input: TripCreate,
    actorUserId: string,
  ): Promise<Trip> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    const routeId = parsePositiveBigInt(input.routeId);
    const busId = parsePositiveBigInt(input.busId);
    if (normalizedCompanyId === null || routeId === null || busId === null) {
      throw new TripAssociationInvalidError(
        'Route and bus must be valid ids in the company.',
      );
    }
    const driverId = this.optionalId(input.driverId);
    const assistantId = this.optionalId(input.assistantId);

    return this.transactions.run(async (tx) => {
      const route = await this.trips.findRouteAssignment(tx, normalizedCompanyId, routeId);
      if (!route) {
        throw new TripAssociationInvalidError('The route was not found in this company.');
      }
      if (!route.isActive) {
        throw new TripAssociationInvalidError('The route is not active.');
      }
      const bus = await this.trips.findBusAssignment(tx, normalizedCompanyId, busId);
      if (!bus) {
        throw new TripAssociationInvalidError('The bus was not found in this company.');
      }
      if (!bus.isActive || bus.status !== BusStatus.Active) {
        throw new TripAssociationInvalidError('The bus is not active and operational.');
      }

      // Validate driver/assistant in the same transaction: same company, not
      // soft-deleted, active, and the correct staff type. This is stricter than
      // the database staff-type trigger (which ignores deleted_at) and yields a
      // precise 422 instead of a generic constraint error.
      if (driverId !== null) {
        await this.assertStaff(tx, normalizedCompanyId, driverId, StaffType.Driver, 'driver');
      }
      if (assistantId !== null) {
        await this.assertStaff(tx, normalizedCompanyId, assistantId, StaffType.Assistant, 'assistant');
      }

      const boardingClosesAt = await this.computeBoardingClosesAt(
        tx,
        normalizedCompanyId,
        input.departureTime,
      );

      const trip = await this.trips.insert(tx, normalizedCompanyId, {
        routeId,
        busId,
        driverId: driverId ?? undefined,
        assistantId: assistantId ?? undefined,
        departureTime: input.departureTime,
        estimatedArrivalTime: input.estimatedArrivalTime,
        boardingClosesAt,
        priceMru: route.defaultPriceMru,
        currency: route.currency,
      });

      await this.events.append(tx, normalizedCompanyId, trip.id, {
        eventType: TripEventType.TripCreated,
        eventSource: TripEventSource.Admin,
        actorUserId,
      });
      return trip;
    });
  }

  /**
   * Edit a still-`SCHEDULED` trip (version-aware). A stale version or a trip past
   * `SCHEDULED` is a `409`; a missing trip is `404`. When the departure moves,
   * the boarding-close time is recomputed server-side.
   */
  async updateTrip(
    companyId: string,
    tripId: string,
    expectedVersion: number,
    input: TripUpdate,
  ): Promise<Trip> {
    if (
      input.departureTime === undefined &&
      input.estimatedArrivalTime === undefined &&
      input.driverId === undefined &&
      input.assistantId === undefined
    ) {
      throw new ValidationException({
        body: ['At least one updatable field must be provided.'],
      });
    }
    const { companyId: c, tripId: t } = this.normalizeTripIds(companyId, tripId);

    return this.transactions.run(async (tx) => {
      // Validate any newly-assigned driver/assistant in the same transaction
      // (a null clears the assignment and needs no validation).
      if (typeof input.driverId === 'string') {
        await this.assertStaff(tx, c, input.driverId, StaffType.Driver, 'driver');
      }
      if (typeof input.assistantId === 'string') {
        await this.assertStaff(tx, c, input.assistantId, StaffType.Assistant, 'assistant');
      }

      const boardingClosesAt =
        input.departureTime !== undefined
          ? await this.computeBoardingClosesAt(tx, c, input.departureTime)
          : null;

      const updated = await this.trips.updateDetails(
        tx,
        c,
        t,
        expectedVersion,
        input,
        boardingClosesAt,
      );
      if (updated) {
        return updated;
      }
      // Nothing matched: separate "missing" from "not schedulable" from "stale".
      const existing = await this.trips.findInCompany(tx, c, t);
      if (!existing) {
        throw new TripNotFoundError();
      }
      if (existing.status !== TripStatus.Scheduled) {
        throw new TripTransitionConflictError();
      }
      throw new TripVersionConflictError();
    });
  }

  /**
   * Apply a lifecycle action (start/complete/cancel) via the centralized
   * transition matrix, atomically writing the status change and its event.
   */
  async applyTransition(
    companyId: string,
    tripId: string,
    action: TripAction,
    actorUserId: string,
  ): Promise<Trip> {
    const { companyId: c, tripId: t } = this.normalizeTripIds(companyId, tripId);
    const spec = TRIP_TRANSITIONS[action];

    return this.transactions.run(async (tx) => {
      const trip = await this.trips.transition(
        tx,
        c,
        t,
        [...spec.from],
        spec.to,
        spec.stamps,
      );
      if (trip) {
        await this.events.append(tx, c, trip.id, {
          eventType: spec.event,
          eventSource: TripEventSource.Admin,
          actorUserId,
        });
        return trip;
      }
      // No row was in an allowed source status: missing → 404, else conflict.
      const existing = await this.trips.findInCompany(tx, c, t);
      if (!existing) {
        throw new TripNotFoundError();
      }
      throw new TripTransitionConflictError();
    });
  }

  /**
   * Assert a staff id references, within the company, a non-deleted, active
   * member of the required type — otherwise a `422`. Runs on the passed executor
   * so it participates in the enclosing lifecycle transaction.
   */
  private async assertStaff(
    executor: DatabaseExecutor,
    companyId: string,
    staffId: string,
    requiredType: StaffType,
    label: 'driver' | 'assistant',
  ): Promise<void> {
    const staff = await this.trips.findStaffAssignment(executor, companyId, staffId);
    if (!staff) {
      throw new TripAssociationInvalidError(`The ${label} was not found in this company.`);
    }
    if (!staff.isActive) {
      throw new TripAssociationInvalidError(`The ${label} is not active.`);
    }
    if (staff.staffType !== requiredType) {
      throw new TripAssociationInvalidError(`The ${label} must be a ${requiredType}.`);
    }
  }

  private async computeBoardingClosesAt(
    executor: DatabaseExecutor,
    companyId: string,
    departureTime: Date,
  ): Promise<Date> {
    const minutes = await this.trips.readBoardingCloseMinutes(executor, companyId);
    return new Date(departureTime.getTime() - minutes * MS_PER_MINUTE);
  }

  private normalizeTripIds(
    companyId: string,
    tripId: string,
  ): { companyId: string; tripId: string } {
    const c = parsePositiveBigInt(companyId);
    const t = parsePositiveBigInt(tripId);
    if (c === null || t === null) {
      throw new TripNotFoundError();
    }
    return { companyId: c, tripId: t };
  }

  /** Normalize an optional id: `undefined`/`null` stays absent, else validated. */
  private optionalId(value: string | undefined): string | null {
    if (value === undefined) {
      return null;
    }
    const normalized = parsePositiveBigInt(value);
    if (normalized === null) {
      throw new TripAssociationInvalidError('Driver/assistant must be a valid id.');
    }
    return normalized;
  }
}
