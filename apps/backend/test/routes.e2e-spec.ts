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
import { ROUTES_REPOSITORY } from '../src/modules/routes/routes.repository';
import { ROUTE_PRICES_REPOSITORY } from '../src/modules/routes/route-prices.repository';
import { STATIONS_REPOSITORY } from '../src/modules/stations/stations.repository';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';
import { InMemoryRoutesRepository } from './support/in-memory-routes.repository';
import { InMemoryRoutePricesRepository } from './support/in-memory-route-prices.repository';
import { InMemoryStationsRepository } from './support/in-memory-stations.repository';
import {
  generateTestKey,
  localJwksResolver,
  signTestToken,
  type TestSigningKey,
} from './support/auth-test-keys';

/** Transaction manager that runs the callback inline (in-memory repos need no real tx). */
const inlineTransactions = {
  run: <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work({}),
};

describe('Routes & pricing (e2e)', () => {
  const ISSUER = 'http://127.0.0.1:54321/auth/v1';
  const AUDIENCE = 'authenticated';
  const MANAGER = '11111111-1111-4111-8111-111111111111';
  const EMPLOYEE = '22222222-2222-4222-8222-222222222222';
  const OUTSIDER = '44444444-4444-4444-8444-444444444444';

  let app: INestApplication;
  let key: TestSigningKey;
  let routesRepo: InMemoryRoutesRepository;

  const auth = (subject: string) =>
    signTestToken(key, { issuer: ISSUER, audience: AUDIENCE, subject }).then((t) => `Bearer ${t}`);

  beforeAll(async () => {
    key = await generateTestKey('routes-e2e', 'ES256');
    const identityRepo = new InMemoryIdentityRepository();
    routesRepo = new InMemoryRoutesRepository();
    const pricesRepo = new InMemoryRoutePricesRepository();
    const stationsRepo = new InMemoryStationsRepository();

    identityRepo.addCompany('10', 'Voyagi');
    identityRepo.addProfile(MANAGER, 'Manager');
    identityRepo.addProfile(EMPLOYEE, 'Employee');
    identityRepo.addProfile(OUTSIDER, 'Outsider');
    identityRepo.addMembership({ id: '100', userId: MANAGER, companyId: '10', role: MembershipRole.CompanyManager });
    identityRepo.addMembership({ id: '101', userId: EMPLOYEE, companyId: '10', role: MembershipRole.BranchEmployee, branchId: '1' });
    identityRepo.addCompany('20', 'Other');
    identityRepo.addMembership({ id: '200', userId: OUTSIDER, companyId: '20', role: MembershipRole.CompanyManager });
    for (let i = 1; i <= 12; i += 1) {
      stationsRepo.addStation({ id: String(i), cityId: '1', nameAr: `م${i}`, nameFr: `S${i}` });
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_KEY_RESOLVER)
      .useValue(localJwksResolver(key))
      .overrideProvider(IDENTITY_REPOSITORY)
      .useValue(identityRepo)
      .overrideProvider(ROUTES_REPOSITORY)
      .useValue(routesRepo)
      .overrideProvider(ROUTE_PRICES_REPOSITORY)
      .useValue(pricesRepo)
      .overrideProvider(STATIONS_REPOSITORY)
      .useValue(stationsRepo)
      .overrideProvider(TransactionManager)
      .useValue(inlineTransactions)
      .compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const base = '/api/v1/companies/10/routes';
  let stationPair = 0;

  async function createRoute(): Promise<string> {
    // A fresh station pair per call so the (company, origin, destination) unique
    // constraint never trips across tests sharing the in-memory repo.
    stationPair += 1;
    const origin = String(stationPair * 2 - 1);
    const destination = String(stationPair * 2);
    const res = await request(app.getHttpServer())
      .post(base)
      .set('Authorization', await auth(MANAGER))
      .send({ originStationId: origin, destinationStationId: destination, defaultPriceMru: 500, estimatedDurationMinutes: 300 });
    return res.body.data.id;
  }

  it('rejects unauthenticated requests (401)', async () => {
    expect((await request(app.getHttpServer()).get(base)).status).toBe(401);
  });

  it('denies a caller with no membership (403)', async () => {
    const res = await request(app.getHttpServer()).get(base).set('Authorization', await auth(OUTSIDER));
    expect(res.status).toBe(403);
  });

  it('lets a reader list, but denies create without routes.manage', async () => {
    const list = await request(app.getHttpServer()).get(base).set('Authorization', await auth(EMPLOYEE));
    expect(list.status).toBe(200);
    const denied = await request(app.getHttpServer())
      .post(base)
      .set('Authorization', await auth(EMPLOYEE))
      .send({ originStationId: '1', destinationStationId: '2', defaultPriceMru: 500, estimatedDurationMinutes: 300 });
    expect(denied.status).toBe(403);
  });

  it('creates a route as a manager (201) and seeds its price history', async () => {
    const routeId = await createRoute();
    expect(routeId).toBeDefined();
    const history = await request(app.getHttpServer())
      .get(`${base}/${routeId}/price-history`)
      .set('Authorization', await auth(MANAGER));
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0]).toMatchObject({ priceMru: 500 });
  });

  it('rejects an invalid create body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post(base)
      .set('Authorization', await auth(MANAGER))
      .send({ originStationId: 'nope', destinationStationId: '2', defaultPriceMru: -5, estimatedDurationMinutes: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404s a route in another company', async () => {
    const routeId = await createRoute();
    const res = await request(app.getHttpServer())
      .get(`/api/v1/companies/20/routes/${routeId}`)
      .set('Authorization', await auth(OUTSIDER));
    // Outsider manages company 20, where this route does not exist.
    expect(res.status).toBe(404);
  });

  it('records a new price (append-only history)', async () => {
    const routeId = await createRoute();
    const priced = await request(app.getHttpServer())
      .post(`${base}/${routeId}/prices`)
      .set('Authorization', await auth(MANAGER))
      .send({ priceMru: 750, changeReason: 'Peak' });
    expect(priced.status).toBe(201);
    expect(priced.body.data).toMatchObject({ priceMru: 750 });

    const history = await request(app.getHttpServer())
      .get(`${base}/${routeId}/price-history`)
      .set('Authorization', await auth(MANAGER));
    expect(history.body.data).toHaveLength(2);
    expect(history.body.data.filter((p: { effectiveTo: string | null }) => p.effectiveTo === null)).toHaveLength(1);
  });

  it('denies pricing without routes.manage (employee, 403)', async () => {
    const routeId = await createRoute();
    const res = await request(app.getHttpServer())
      .post(`${base}/${routeId}/prices`)
      .set('Authorization', await auth(EMPLOYEE))
      .send({ priceMru: 750 });
    expect(res.status).toBe(403);
  });

  it('surfaces a repository outage as 503', async () => {
    routesRepo.failNextWith(new DatabaseConnectionError());
    const res = await request(app.getHttpServer()).get(base).set('Authorization', await auth(MANAGER));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_FAILURE');
  });
});
