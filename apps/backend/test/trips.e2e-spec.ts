import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { DatabaseConnectionError } from '../src/infrastructure/database/database.errors';
import { TransactionManager } from '../src/infrastructure/database';
import { AUTH_KEY_RESOLVER } from '../src/modules/auth/jwks-key-resolver.provider';
import { IDENTITY_REPOSITORY } from '../src/modules/identity/identity.repository';
import { MembershipRole } from '../src/modules/identity/membership-role';
import { TRIPS_REPOSITORY } from '../src/modules/trips/trips.repository';
import { TRIP_EVENTS_REPOSITORY } from '../src/modules/trips/trip-events.repository';
import { MAINTENANCE_SCHEDULING_PORT } from '../src/modules/maintenance/maintenance-scheduling.port';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';
import { InMemoryTripsRepository } from './support/in-memory-trips.repository';
import { InMemoryTripEventsRepository } from './support/in-memory-trip-events.repository';
import {
  generateTestKey,
  localJwksResolver,
  signTestToken,
  type TestSigningKey,
} from './support/auth-test-keys';

const inlineTransactions = {
  run: <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work({}),
};
const noMaintenanceOverlap = { hasActiveMaintenanceOverlap: async (): Promise<boolean> => false };

const DEP = '2026-03-01T08:00:00.000Z';
const ARR = '2026-03-01T13:00:00.000Z';

describe('Trips (e2e)', () => {
  const ISSUER = 'http://127.0.0.1:54321/auth/v1';
  const AUDIENCE = 'authenticated';
  const MANAGER = '11111111-1111-4111-8111-111111111111';
  const EMPLOYEE = '22222222-2222-4222-8222-222222222222';
  const OUTSIDER = '44444444-4444-4444-8444-444444444444';

  let app: INestApplication;
  let key: TestSigningKey;
  let tripsRepo: InMemoryTripsRepository;

  const auth = (subject: string) =>
    signTestToken(key, { issuer: ISSUER, audience: AUDIENCE, subject }).then((t) => `Bearer ${t}`);
  const base = '/api/v1/companies/10/trips';

  beforeAll(async () => {
    key = await generateTestKey('trips-e2e', 'ES256');
    const identityRepo = new InMemoryIdentityRepository();
    tripsRepo = new InMemoryTripsRepository();
    const eventsRepo = new InMemoryTripEventsRepository();

    identityRepo.addCompany('10', 'Voyagi');
    identityRepo.addCompany('20', 'Other');
    identityRepo.addProfile(MANAGER, 'Manager');
    identityRepo.addProfile(EMPLOYEE, 'Employee');
    identityRepo.addProfile(OUTSIDER, 'Outsider');
    identityRepo.addMembership({ id: '100', userId: MANAGER, companyId: '10', role: MembershipRole.CompanyManager });
    identityRepo.addMembership({ id: '101', userId: EMPLOYEE, companyId: '10', role: MembershipRole.BranchEmployee, branchId: '1' });
    identityRepo.addMembership({ id: '200', userId: OUTSIDER, companyId: '20', role: MembershipRole.CompanyManager });

    tripsRepo.addRouteAssignment('10', '500', { isActive: true, defaultPriceMru: 500, currency: 'MRU' });
    for (let b = 600; b <= 610; b += 1) {
      tripsRepo.addBusAssignment('10', String(b), { isActive: true, status: 'ACTIVE' });
    }
    tripsRepo.addStaffAssignment('10', '700', { isActive: true, staffType: 'DRIVER' });
    tripsRepo.addStaffAssignment('10', '710', { isActive: true, staffType: 'ASSISTANT' });
    tripsRepo.addStaffAssignment('10', '701', { isActive: false, staffType: 'DRIVER' });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_KEY_RESOLVER)
      .useValue(localJwksResolver(key))
      .overrideProvider(IDENTITY_REPOSITORY)
      .useValue(identityRepo)
      .overrideProvider(TRIPS_REPOSITORY)
      .useValue(tripsRepo)
      .overrideProvider(TRIP_EVENTS_REPOSITORY)
      .useValue(eventsRepo)
      .overrideProvider(TransactionManager)
      .useValue(inlineTransactions)
      .overrideProvider(MAINTENANCE_SCHEDULING_PORT)
      .useValue(noMaintenanceOverlap)
      .compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const createTrip = async (busId: string, departureTime = DEP, estimatedArrivalTime = ARR) =>
    request(app.getHttpServer())
      .post(base)
      .set('Authorization', await auth(MANAGER))
      .send({ routeId: '500', busId, departureTime, estimatedArrivalTime });

  it('rejects unauthenticated requests (401)', async () => {
    expect((await request(app.getHttpServer()).get(base)).status).toBe(401);
  });

  it('denies a caller with no membership (403)', async () => {
    expect((await request(app.getHttpServer()).get(base).set('Authorization', await auth(OUTSIDER))).status).toBe(403);
  });

  it('lets a reader list, but denies scheduling without trips.manage', async () => {
    expect((await request(app.getHttpServer()).get(base).set('Authorization', await auth(EMPLOYEE))).status).toBe(200);
    const denied = await request(app.getHttpServer())
      .post(base)
      .set('Authorization', await auth(EMPLOYEE))
      .send({ routeId: '500', busId: '600', departureTime: DEP, estimatedArrivalTime: ARR });
    expect(denied.status).toBe(403);
  });

  it('schedules a trip (201) with a snapshotted price and default status', async () => {
    const res = await createTrip('600');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ companyId: '10', status: 'SCHEDULED', priceMru: 500, version: 1 });
  });

  it('schedules a trip with a valid driver + assistant (201)', async () => {
    const res = await request(app.getHttpServer())
      .post(base)
      .set('Authorization', await auth(MANAGER))
      .send({ routeId: '500', busId: '609', departureTime: DEP, estimatedArrivalTime: ARR, driverId: '700', assistantId: '710' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ driverId: '700', assistantId: '710' });
  });

  it('rejects invalid staff: wrong type, inactive, or cross-company driver (422)', async () => {
    const token = await auth(MANAGER);
    const send = (driverId: string) =>
      request(app.getHttpServer())
        .post(base)
        .set('Authorization', token)
        .send({ routeId: '500', busId: '610', departureTime: DEP, estimatedArrivalTime: ARR, driverId });
    // Wrong type: an ASSISTANT id used as the driver.
    expect((await send('710')).status).toBe(422);
    // Inactive driver.
    expect((await send('701')).status).toBe(422);
    // Cross-company / unknown driver (not in company 10).
    expect((await send('999')).status).toBe(422);
  });

  it('runs the start → complete lifecycle and records events', async () => {
    const trip = (await createTrip('601')).body.data;
    const started = await request(app.getHttpServer()).post(`${base}/${trip.id}/start`).set('Authorization', await auth(MANAGER));
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe('ONGOING');

    const completed = await request(app.getHttpServer()).post(`${base}/${trip.id}/complete`).set('Authorization', await auth(MANAGER));
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe('COMPLETED');

    const events = await request(app.getHttpServer()).get(`${base}/${trip.id}/events`).set('Authorization', await auth(MANAGER));
    expect(events.status).toBe(200);
    expect(events.body.data.map((e: { eventType: string }) => e.eventType)).toEqual(['ARRIVED', 'DEPARTED', 'TRIP_CREATED']);
  });

  it('rejects an invalid transition (completing a scheduled trip → 409)', async () => {
    const trip = (await createTrip('602')).body.data;
    const res = await request(app.getHttpServer()).post(`${base}/${trip.id}/complete`).set('Authorization', await auth(MANAGER));
    expect(res.status).toBe(409);
  });

  it('prevents an overlapping bus schedule (409)', async () => {
    await createTrip('603', DEP, ARR);
    const overlap = await createTrip('603', '2026-03-01T10:00:00.000Z', '2026-03-01T15:00:00.000Z');
    expect(overlap.status).toBe(409);
  });

  it('enforces optimistic locking on edits (stale version → 409)', async () => {
    const trip = (await createTrip('604')).body.data;
    const res = await request(app.getHttpServer())
      .patch(`${base}/${trip.id}`)
      .set('Authorization', await auth(MANAGER))
      .send({ expectedVersion: 999, estimatedArrivalTime: '2026-03-01T14:00:00.000Z' });
    expect(res.status).toBe(409);
  });

  it('404s a trip in another company', async () => {
    const trip = (await createTrip('605')).body.data;
    const res = await request(app.getHttpServer())
      .get(`/api/v1/companies/20/trips/${trip.id}`)
      .set('Authorization', await auth(OUTSIDER));
    expect(res.status).toBe(404);
  });

  it('rejects an invalid create body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post(base)
      .set('Authorization', await auth(MANAGER))
      .send({ routeId: 'nope', busId: '600', departureTime: 'not-a-date', estimatedArrivalTime: ARR });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('surfaces a repository outage as 503', async () => {
    tripsRepo.failNextWith(new DatabaseConnectionError());
    const res = await request(app.getHttpServer()).get(base).set('Authorization', await auth(MANAGER));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_FAILURE');
  });
});
