import type { DatabaseService, TransactionManager } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { resolvePagination } from '../../common/pagination/pagination';
import { ValidationException } from '../../common/validation/validation.exception';
import {
  TripAssociationInvalidError,
  TripNotFoundError,
  TripTransitionConflictError,
  TripVersionConflictError,
} from './trip.errors';
import { StaffType } from '../staff/staff-type';
import { TripStatus } from './trip-status';
import { TripEventType } from './trip-event.types';
import { TripAction } from './trip-transitions';
import type { TripEventsRepository } from './trip-events.repository';
import type { TripEvent, TripEventCreate } from './trip-event.types';
import type {
  BusAssignment,
  PagedResult,
  RouteAssignment,
  StaffAssignment,
  TripsRepository,
} from './trips.repository';
import type { Trip, TripInsert } from './trip.types';
import { TripsService } from './trips.service';
import type { MaintenanceSchedulingPort } from '../maintenance/maintenance-scheduling.port';

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: '7',
    companyId: '10',
    routeId: '3',
    busId: '5',
    departureTime: new Date('2026-03-01T08:00:00.000Z'),
    estimatedArrivalTime: new Date('2026-03-01T13:00:00.000Z'),
    boardingClosesAt: new Date('2026-03-01T07:30:00.000Z'),
    priceMru: 500,
    currency: 'MRU',
    status: TripStatus.Scheduled,
    isActive: true,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakeTripsRepository implements TripsRepository {
  route: RouteAssignment | null = { isActive: true, defaultPriceMru: 500, currency: 'MRU' };
  bus: BusAssignment | null = { isActive: true, status: 'ACTIVE' };
  staff = new Map<string, StaffAssignment>();
  existing: Trip | null = null;
  updateResult: Trip | null = null;
  transitionResult: Trip | null = null;
  inserted: TripInsert | null = null;

  listByCompany(): Promise<PagedResult<Trip>> {
    return Promise.resolve({ items: [], total: 0 });
  }
  findInCompany(): Promise<Trip | null> {
    return Promise.resolve(this.existing);
  }
  findRouteAssignment(): Promise<RouteAssignment | null> {
    return Promise.resolve(this.route);
  }
  findBusAssignment(): Promise<BusAssignment | null> {
    return Promise.resolve(this.bus);
  }
  lockBusAssignment(): Promise<BusAssignment | null> {
    return Promise.resolve(this.bus);
  }
  findStaffAssignment(_e: DatabaseExecutor, _c: string, staffId: string): Promise<StaffAssignment | null> {
    return Promise.resolve(this.staff.get(staffId) ?? null);
  }
  readBoardingCloseMinutes(): Promise<number> {
    return Promise.resolve(30);
  }
  insert(_e: DatabaseExecutor, _c: string, input: TripInsert): Promise<Trip> {
    this.inserted = input;
    return Promise.resolve(makeTrip({ ...input, id: '7', companyId: '10' }));
  }
  updateDetails(): Promise<Trip | null> {
    return Promise.resolve(this.updateResult);
  }
  transition(): Promise<Trip | null> {
    return Promise.resolve(this.transitionResult);
  }
}

class FakeTripEventsRepository implements TripEventsRepository {
  appended: TripEventCreate[] = [];
  append(
    _e: DatabaseExecutor,
    _c: string,
    _t: string,
    input: TripEventCreate,
  ): Promise<TripEvent> {
    this.appended.push(input);
    return Promise.resolve({
      id: '1',
      tripId: '7',
      companyId: '10',
      eventType: input.eventType,
      eventSource: input.eventSource,
      eventTime: new Date(),
      createdAt: new Date(),
    });
  }
  listByTrip(): Promise<PagedResult<TripEvent>> {
    return Promise.resolve({ items: [], total: 0 });
  }
}

const fakeTransactions = {
  run: <T>(work: (tx: DatabaseExecutor) => Promise<T>): Promise<T> =>
    work({} as DatabaseExecutor),
} as unknown as TransactionManager;
const fakeDb = {} as DatabaseService;
const fakeMaintenance: MaintenanceSchedulingPort = {
  hasActiveMaintenanceOverlap: () => Promise.resolve(false),
};

const CREATE_INPUT = {
  routeId: '3',
  busId: '5',
  departureTime: new Date('2026-03-01T08:00:00.000Z'),
  estimatedArrivalTime: new Date('2026-03-01T13:00:00.000Z'),
};

describe('TripsService', () => {
  let repo: FakeTripsRepository;
  let events: FakeTripEventsRepository;
  let service: TripsService;

  beforeEach(() => {
    repo = new FakeTripsRepository();
    events = new FakeTripEventsRepository();
    service = new TripsService(repo, events, fakeDb, fakeTransactions, fakeMaintenance);
  });

  it('returns an empty page for a malformed company id', async () => {
    expect(await service.listTrips('bad', resolvePagination())).toEqual({ items: [], total: 0 });
  });

  it('rejects creation when the route is missing/inactive in the company (422)', async () => {
    repo.route = null;
    await expect(service.createTrip('10', CREATE_INPUT, 'u1')).rejects.toBeInstanceOf(TripAssociationInvalidError);
    repo.route = { isActive: false, defaultPriceMru: 500, currency: 'MRU' };
    await expect(service.createTrip('10', CREATE_INPUT, 'u1')).rejects.toBeInstanceOf(TripAssociationInvalidError);
  });

  it('rejects creation when the bus is missing/not operational (422)', async () => {
    repo.bus = null;
    await expect(service.createTrip('10', CREATE_INPUT, 'u1')).rejects.toBeInstanceOf(TripAssociationInvalidError);
    repo.bus = { isActive: true, status: 'IN_MAINTENANCE' };
    await expect(service.createTrip('10', CREATE_INPUT, 'u1')).rejects.toBeInstanceOf(TripAssociationInvalidError);
  });

  it('creates a trip, snapshots the route price, and appends TRIP_CREATED', async () => {
    const trip = await service.createTrip('10', CREATE_INPUT, 'u1');
    expect(trip.companyId).toBe('10');
    expect(repo.inserted).toMatchObject({ priceMru: 500, currency: 'MRU' });
    // boarding_closes_at = departure − 30 min.
    expect(repo.inserted?.boardingClosesAt.toISOString()).toBe('2026-03-01T07:30:00.000Z');
    expect(events.appended).toEqual([
      expect.objectContaining({ eventType: TripEventType.TripCreated, actorUserId: 'u1' }),
    ]);
  });

  it('rejects a driver that is missing, cross-company, inactive, or the wrong type (422)', async () => {
    const withDriver = { ...CREATE_INPUT, driverId: '2' };
    // Missing / cross-company (not in the map).
    await expect(service.createTrip('10', withDriver, 'u1')).rejects.toBeInstanceOf(TripAssociationInvalidError);
    // Inactive.
    repo.staff.set('2', { isActive: false, staffType: 'DRIVER' });
    await expect(service.createTrip('10', withDriver, 'u1')).rejects.toBeInstanceOf(TripAssociationInvalidError);
    // Wrong type (an ASSISTANT supplied as the driver).
    repo.staff.set('2', { isActive: true, staffType: 'ASSISTANT' });
    await expect(service.createTrip('10', withDriver, 'u1')).rejects.toBeInstanceOf(TripAssociationInvalidError);
    // Valid active DRIVER → accepted.
    repo.staff.set('2', { isActive: true, staffType: StaffType.Driver });
    await expect(service.createTrip('10', withDriver, 'u1')).resolves.toMatchObject({ driverId: '2' });
  });

  it('validates the assistant type on update (wrong type → 422)', async () => {
    repo.staff.set('3', { isActive: true, staffType: 'DRIVER' });
    await expect(
      service.updateTrip('10', '7', 1, { assistantId: '3' }),
    ).rejects.toBeInstanceOf(TripAssociationInvalidError);
  });

  it('rejects an empty update with a validation error', async () => {
    await expect(service.updateTrip('10', '7', 1, {})).rejects.toBeInstanceOf(ValidationException);
  });

  it('disambiguates a failed update: 404 missing, 409 not-editable, 409 stale version', async () => {
    repo.updateResult = null;

    repo.existing = null;
    await expect(service.updateTrip('10', '7', 1, { estimatedArrivalTime: new Date() })).rejects.toBeInstanceOf(TripNotFoundError);

    repo.existing = makeTrip({ status: TripStatus.Ongoing });
    await expect(service.updateTrip('10', '7', 1, { estimatedArrivalTime: new Date() })).rejects.toBeInstanceOf(TripTransitionConflictError);

    repo.existing = makeTrip({ status: TripStatus.Scheduled, version: 5 });
    await expect(service.updateTrip('10', '7', 1, { estimatedArrivalTime: new Date() })).rejects.toBeInstanceOf(TripVersionConflictError);
  });

  it('applies a transition and appends its event; disambiguates a no-op', async () => {
    repo.transitionResult = makeTrip({ status: TripStatus.Ongoing });
    const started = await service.applyTransition('10', '7', TripAction.Start, 'u1');
    expect(started.status).toBe(TripStatus.Ongoing);
    expect(events.appended).toEqual([expect.objectContaining({ eventType: TripEventType.Departed })]);

    // No row transitioned + trip missing → 404.
    repo.transitionResult = null;
    repo.existing = null;
    await expect(service.applyTransition('10', '7', TripAction.Start, 'u1')).rejects.toBeInstanceOf(TripNotFoundError);

    // No row transitioned + trip present (wrong state) → conflict.
    repo.existing = makeTrip({ status: TripStatus.Completed });
    await expect(service.applyTransition('10', '7', TripAction.Complete, 'u1')).rejects.toBeInstanceOf(TripTransitionConflictError);
  });
});
