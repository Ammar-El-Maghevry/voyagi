import type { ResolvedPagination } from '../../src/common/pagination/pagination';
import type { DatabaseExecutor } from '../../src/infrastructure/database/database.types';
import { ExclusionConstraintViolationError } from '../../src/infrastructure/database/database.errors';
import { TripStatus } from '../../src/modules/trips/trip-status';
import type { TripTimestampField } from '../../src/modules/trips/trip-transitions';
import type {
  BusAssignment,
  PagedResult,
  RouteAssignment,
  StaffAssignment,
  TripsRepository,
} from '../../src/modules/trips/trips.repository';
import type { Trip, TripInsert, TripUpdate } from '../../src/modules/trips/trip.types';

/**
 * In-memory {@link TripsRepository} for e2e tests. Preserves the SQL adapter's
 * observable semantics — company scoping, the bus-overlap exclusion, atomic
 * status transitions and version-aware edits — without a real database. Route
 * and bus "assignments" are seeded so creation can validate them.
 */
export class InMemoryTripsRepository implements TripsRepository {
  private readonly trips: Trip[] = [];
  private readonly routeAssignments = new Map<string, RouteAssignment>();
  private readonly busAssignments = new Map<string, BusAssignment>();
  private readonly staffAssignments = new Map<string, StaffAssignment>();
  private sequence = 9000;
  private failWith: Error | null = null;

  addRouteAssignment(companyId: string, routeId: string, a: RouteAssignment): void {
    this.routeAssignments.set(`${companyId}:${routeId}`, a);
  }
  addBusAssignment(companyId: string, busId: string, a: BusAssignment): void {
    this.busAssignments.set(`${companyId}:${busId}`, a);
  }
  addStaffAssignment(companyId: string, staffId: string, a: StaffAssignment): void {
    this.staffAssignments.set(`${companyId}:${staffId}`, a);
  }

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

  listByCompany(
    _e: DatabaseExecutor,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Trip>> {
    this.maybeFail();
    const all = this.trips
      .filter((t) => t.companyId === companyId)
      .sort((a, b) => b.departureTime.getTime() - a.departureTime.getTime());
    return Promise.resolve({
      items: all.slice(pagination.offset, pagination.offset + pagination.limit),
      total: all.length,
    });
  }

  findInCompany(_e: DatabaseExecutor, companyId: string, tripId: string): Promise<Trip | null> {
    this.maybeFail();
    return Promise.resolve(this.trips.find((t) => t.id === tripId && t.companyId === companyId) ?? null);
  }

  findRouteAssignment(_e: DatabaseExecutor, companyId: string, routeId: string): Promise<RouteAssignment | null> {
    return Promise.resolve(this.routeAssignments.get(`${companyId}:${routeId}`) ?? null);
  }
  findBusAssignment(_e: DatabaseExecutor, companyId: string, busId: string): Promise<BusAssignment | null> {
    return Promise.resolve(this.busAssignments.get(`${companyId}:${busId}`) ?? null);
  }
  lockBusAssignment(_e: DatabaseExecutor, companyId: string, busId: string): Promise<BusAssignment | null> {
    return Promise.resolve(this.busAssignments.get(`${companyId}:${busId}`) ?? null);
  }
  findStaffAssignment(_e: DatabaseExecutor, companyId: string, staffId: string): Promise<StaffAssignment | null> {
    return Promise.resolve(this.staffAssignments.get(`${companyId}:${staffId}`) ?? null);
  }
  readBoardingCloseMinutes(): Promise<number> {
    return Promise.resolve(30);
  }

  insert(_e: DatabaseExecutor, companyId: string, input: TripInsert): Promise<Trip> {
    this.maybeFail();
    const overlaps = this.trips.some(
      (t) =>
        t.companyId === companyId &&
        t.busId === input.busId &&
        t.status !== TripStatus.Cancelled &&
        input.departureTime < t.estimatedArrivalTime &&
        t.departureTime < input.estimatedArrivalTime,
    );
    if (overlaps) {
      throw new ExclusionConstraintViolationError();
    }
    const now = new Date();
    const trip: Trip = {
      id: String(++this.sequence),
      companyId,
      routeId: input.routeId,
      busId: input.busId,
      driverId: input.driverId,
      assistantId: input.assistantId,
      departureTime: input.departureTime,
      estimatedArrivalTime: input.estimatedArrivalTime,
      boardingClosesAt: input.boardingClosesAt,
      priceMru: input.priceMru,
      currency: input.currency,
      status: TripStatus.Scheduled,
      isActive: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.trips.push(trip);
    return Promise.resolve(trip);
  }

  updateDetails(
    _e: DatabaseExecutor,
    companyId: string,
    tripId: string,
    expectedVersion: number,
    input: TripUpdate,
    boardingClosesAt: Date | null,
  ): Promise<Trip | null> {
    this.maybeFail();
    const index = this.trips.findIndex(
      (t) =>
        t.id === tripId &&
        t.companyId === companyId &&
        t.status === TripStatus.Scheduled &&
        t.version === expectedVersion,
    );
    if (index === -1) return Promise.resolve(null);
    const current = this.trips[index];
    const next: Trip = {
      ...current,
      departureTime: input.departureTime ?? current.departureTime,
      estimatedArrivalTime: input.estimatedArrivalTime ?? current.estimatedArrivalTime,
      driverId: input.driverId === undefined ? current.driverId : (input.driverId ?? undefined),
      assistantId: input.assistantId === undefined ? current.assistantId : (input.assistantId ?? undefined),
      boardingClosesAt: boardingClosesAt ?? current.boardingClosesAt,
      version: current.version + 1,
      updatedAt: new Date(),
    };
    this.trips[index] = next;
    return Promise.resolve(next);
  }

  transition(
    _e: DatabaseExecutor,
    companyId: string,
    tripId: string,
    from: readonly TripStatus[],
    to: TripStatus,
    stamps: TripTimestampField,
  ): Promise<Trip | null> {
    this.maybeFail();
    const index = this.trips.findIndex(
      (t) => t.id === tripId && t.companyId === companyId && from.includes(t.status),
    );
    if (index === -1) return Promise.resolve(null);
    const current = this.trips[index];
    const now = new Date();
    const next: Trip = {
      ...current,
      status: to,
      version: current.version + 1,
      actualDepartureTime:
        stamps === 'actual_departure_time' ? now : current.actualDepartureTime,
      actualArrivalTime:
        stamps === 'actual_arrival_time' ? now : current.actualArrivalTime,
      updatedAt: now,
    };
    this.trips[index] = next;
    return Promise.resolve(next);
  }
}
