import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { DatabaseConnectionError } from '../src/infrastructure/database/database.errors';
import { AUTH_KEY_RESOLVER } from '../src/modules/auth/jwks-key-resolver.provider';
import { BUSES_REPOSITORY } from '../src/modules/buses/buses.repository';
import { IDENTITY_REPOSITORY } from '../src/modules/identity/identity.repository';
import { MembershipRole } from '../src/modules/identity/membership-role';
import { InMemoryBusesRepository } from './support/in-memory-buses.repository';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';
import {
  generateTestKey,
  localJwksResolver,
  signTestToken,
  type TestSigningKey,
} from './support/auth-test-keys';

/**
 * End-to-end coverage of the fleet (buses) module. Buses are company-scoped:
 * any active member with `fleet.read` lists all company buses, while writes
 * require the company-wide `fleet.manage`. Runs the full HTTP pipeline against
 * in-memory repositories.
 */
describe('Buses / fleet (e2e)', () => {
  const ISSUER = 'http://127.0.0.1:54321/auth/v1';
  const AUDIENCE = 'authenticated';

  const MANAGER = '11111111-1111-4111-8111-111111111111';
  const EMPLOYEE = '22222222-2222-4222-8222-222222222222';
  const OUTSIDER = '44444444-4444-4444-8444-444444444444';

  let app: INestApplication;
  let key: TestSigningKey;
  let identityRepo: InMemoryIdentityRepository;
  let busesRepo: InMemoryBusesRepository;

  const auth = (subject: string) =>
    signTestToken(key, { issuer: ISSUER, audience: AUDIENCE, subject }).then(
      (t) => `Bearer ${t}`,
    );

  beforeAll(async () => {
    key = await generateTestKey('buses-e2e', 'ES256');
    identityRepo = new InMemoryIdentityRepository();
    busesRepo = new InMemoryBusesRepository();

    identityRepo.addCompany('10', 'Voyagi');
    identityRepo.addCompany('20', 'Other Co');
    identityRepo.addProfile(MANAGER, 'Manager Mona');
    identityRepo.addProfile(EMPLOYEE, 'Employee Emma');
    identityRepo.addProfile(OUTSIDER, 'Outsider Omar');
    identityRepo.addMembership({ id: '100', userId: MANAGER, companyId: '10', role: MembershipRole.CompanyManager });
    identityRepo.addMembership({ id: '101', userId: EMPLOYEE, companyId: '10', role: MembershipRole.BranchEmployee, branchId: '1' });
    identityRepo.addMembership({ id: '200', userId: OUTSIDER, companyId: '20', role: MembershipRole.CompanyManager });

    busesRepo.addBus({ id: '1', companyId: '10', seatLayoutId: '3', plateNumber: 'AA-001' });
    busesRepo.addBus({ id: '2', companyId: '10', seatLayoutId: '3', plateNumber: 'AA-002' });
    busesRepo.addBus({ id: '3', companyId: '20', seatLayoutId: '3', plateNumber: 'BB-001' });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_KEY_RESOLVER)
      .useValue(localJwksResolver(key))
      .overrideProvider(IDENTITY_REPOSITORY)
      .useValue(identityRepo)
      .overrideProvider(BUSES_REPOSITORY)
      .useValue(busesRepo)
      .compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an unauthenticated request (401)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/companies/10/buses');
    expect(res.status).toBe(401);
  });

  it('denies a caller with no membership in the company (403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/companies/10/buses')
      .set('Authorization', await auth(OUTSIDER));
    expect(res.status).toBe(403);
  });

  it('lets any active member with fleet.read list all company buses (company-scoped)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/companies/10/buses')
      .set('Authorization', await auth(EMPLOYEE));
    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { id: string }) => b.id).sort()).toEqual(['1', '2']);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
  });

  it('denies create without fleet.manage (employee, 403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/companies/10/buses')
      .set('Authorization', await auth(EMPLOYEE))
      .send({ seatLayoutId: '3', plateNumber: 'AA-777' });
    expect(res.status).toBe(403);
  });

  it('creates a bus as a manager (201), defaulting status and version', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/companies/10/buses')
      .set('Authorization', await auth(MANAGER))
      .send({ seatLayoutId: '3', plateNumber: 'AA-100', busModel: 'Coach', currentOdometerKm: 500 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      companyId: '10',
      plateNumber: 'AA-100',
      status: 'ACTIVE',
      isActive: true,
      currentOdometerKm: 500,
      version: 1,
    });
  });

  it('rejects an invalid create body (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/companies/10/buses')
      .set('Authorization', await auth(MANAGER))
      .send({ seatLayoutId: 'not-an-id', currentOdometerKm: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reads a bus, and 404s one from another company (tenant isolation)', async () => {
    const ok = await request(app.getHttpServer())
      .get('/api/v1/companies/10/buses/1')
      .set('Authorization', await auth(MANAGER));
    expect(ok.status).toBe(200);
    expect(ok.body.data.id).toBe('1');

    const cross = await request(app.getHttpServer())
      .get('/api/v1/companies/10/buses/3')
      .set('Authorization', await auth(MANAGER));
    expect(cross.status).toBe(404);
  });

  it('rejects a duplicate plate number (409)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/companies/10/buses')
      .set('Authorization', await auth(MANAGER))
      .send({ seatLayoutId: '3', plateNumber: 'AA-001' });
    expect(res.status).toBe(409);
  });

  it('updates a bus (bumping version), then transitions activation with a redundant-transition conflict', async () => {
    const updated = await request(app.getHttpServer())
      .patch('/api/v1/companies/10/buses/1')
      .set('Authorization', await auth(MANAGER))
      .send({ currentOdometerKm: 9000 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.currentOdometerKm).toBe(9000);
    expect(updated.body.data.version).toBe(2);

    const off = await request(app.getHttpServer())
      .post('/api/v1/companies/10/buses/1/deactivate')
      .set('Authorization', await auth(MANAGER));
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);

    const again = await request(app.getHttpServer())
      .post('/api/v1/companies/10/buses/1/deactivate')
      .set('Authorization', await auth(MANAGER));
    expect(again.status).toBe(409);
  });

  it('surfaces a repository outage as 503', async () => {
    busesRepo.failNextWith(new DatabaseConnectionError());
    const res = await request(app.getHttpServer())
      .get('/api/v1/companies/10/buses')
      .set('Authorization', await auth(MANAGER));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_FAILURE');
  });
});
