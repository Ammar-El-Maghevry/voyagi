import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { DatabaseConnectionError } from '../src/infrastructure/database/database.errors';
import { AUTH_KEY_RESOLVER } from '../src/modules/auth/jwks-key-resolver.provider';
import { IDENTITY_REPOSITORY } from '../src/modules/identity/identity.repository';
import { MembershipRole } from '../src/modules/identity/membership-role';
import { STAFF_REPOSITORY } from '../src/modules/staff/staff.repository';
import { StaffType } from '../src/modules/staff/staff-type';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';
import { InMemoryStaffRepository } from './support/in-memory-staff.repository';
import {
  generateTestKey,
  localJwksResolver,
  signTestToken,
  type TestSigningKey,
} from './support/auth-test-keys';

/**
 * End-to-end coverage of the staff module. Staff are company-scoped: any active
 * member with `staff.read` lists all company staff, while writes require the
 * company-wide `staff.manage`. Runs the full HTTP pipeline against in-memory
 * repositories.
 */
describe('Staff members (e2e)', () => {
  const ISSUER = 'http://127.0.0.1:54321/auth/v1';
  const AUDIENCE = 'authenticated';

  const MANAGER = '11111111-1111-4111-8111-111111111111';
  const EMPLOYEE = '22222222-2222-4222-8222-222222222222';
  const OUTSIDER = '44444444-4444-4444-8444-444444444444';

  let app: INestApplication;
  let key: TestSigningKey;
  let identityRepo: InMemoryIdentityRepository;
  let staffRepo: InMemoryStaffRepository;

  const auth = (subject: string) =>
    signTestToken(key, { issuer: ISSUER, audience: AUDIENCE, subject }).then(
      (t) => `Bearer ${t}`,
    );

  beforeAll(async () => {
    key = await generateTestKey('staff-e2e', 'ES256');
    identityRepo = new InMemoryIdentityRepository();
    staffRepo = new InMemoryStaffRepository();

    identityRepo.addCompany('10', 'Voyagi');
    identityRepo.addCompany('20', 'Other Co');
    identityRepo.addProfile(MANAGER, 'Manager Mona');
    identityRepo.addProfile(EMPLOYEE, 'Employee Emma');
    identityRepo.addProfile(OUTSIDER, 'Outsider Omar');
    identityRepo.addMembership({ id: '100', userId: MANAGER, companyId: '10', role: MembershipRole.CompanyManager });
    identityRepo.addMembership({ id: '101', userId: EMPLOYEE, companyId: '10', role: MembershipRole.BranchEmployee, branchId: '1' });
    identityRepo.addMembership({ id: '200', userId: OUTSIDER, companyId: '20', role: MembershipRole.CompanyManager });

    staffRepo.addStaff({ id: '1', companyId: '10', fullName: 'Driver One', staffType: StaffType.Driver });
    staffRepo.addStaff({ id: '2', companyId: '10', fullName: 'Assistant Two', staffType: StaffType.Assistant });
    staffRepo.addStaff({ id: '3', companyId: '20', fullName: 'Other Driver', staffType: StaffType.Driver });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_KEY_RESOLVER)
      .useValue(localJwksResolver(key))
      .overrideProvider(IDENTITY_REPOSITORY)
      .useValue(identityRepo)
      .overrideProvider(STAFF_REPOSITORY)
      .useValue(staffRepo)
      .compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an unauthenticated request (401)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/companies/10/staff-members');
    expect(res.status).toBe(401);
  });

  it('denies a caller with no membership in the company (403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/companies/10/staff-members')
      .set('Authorization', await auth(OUTSIDER));
    expect(res.status).toBe(403);
  });

  it('lets any active member with staff.read list all company staff (company-scoped)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/companies/10/staff-members')
      .set('Authorization', await auth(EMPLOYEE));
    expect(res.status).toBe(200);
    // Company-scoped: the employee sees every company staff member, not a branch subset.
    expect(res.body.data.map((s: { id: string }) => s.id).sort()).toEqual(['1', '2']);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
  });

  it('denies create without staff.manage (employee, 403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/companies/10/staff-members')
      .set('Authorization', await auth(EMPLOYEE))
      .send({ fullName: 'New Driver', staffType: 'DRIVER' });
    expect(res.status).toBe(403);
  });

  it('creates a staff member as a manager (201)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/companies/10/staff-members')
      .set('Authorization', await auth(MANAGER))
      .send({ fullName: 'New Driver', staffType: 'DRIVER', phone: '+22212345678' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ companyId: '10', fullName: 'New Driver', staffType: 'DRIVER' });
  });

  it('rejects an invalid staff type (400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/companies/10/staff-members')
      .set('Authorization', await auth(MANAGER))
      .send({ fullName: 'Nope', staffType: 'PILOT' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reads a staff member, and 404s one from another company', async () => {
    const ok = await request(app.getHttpServer())
      .get('/api/v1/companies/10/staff-members/1')
      .set('Authorization', await auth(MANAGER));
    expect(ok.status).toBe(200);
    expect(ok.body.data.id).toBe('1');

    const cross = await request(app.getHttpServer())
      .get('/api/v1/companies/10/staff-members/3')
      .set('Authorization', await auth(MANAGER));
    expect(cross.status).toBe(404);
  });

  it('updates, then transitions activation with a redundant-transition conflict', async () => {
    const updated = await request(app.getHttpServer())
      .patch('/api/v1/companies/10/staff-members/1')
      .set('Authorization', await auth(MANAGER))
      .send({ staffType: 'ASSISTANT' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.staffType).toBe('ASSISTANT');

    const off = await request(app.getHttpServer())
      .post('/api/v1/companies/10/staff-members/1/deactivate')
      .set('Authorization', await auth(MANAGER));
    expect(off.status).toBe(200);

    const again = await request(app.getHttpServer())
      .post('/api/v1/companies/10/staff-members/1/deactivate')
      .set('Authorization', await auth(MANAGER));
    expect(again.status).toBe(409);
  });

  it('surfaces a repository outage as 503', async () => {
    staffRepo.failNextWith(new DatabaseConnectionError());
    const res = await request(app.getHttpServer())
      .get('/api/v1/companies/10/staff-members')
      .set('Authorization', await auth(MANAGER));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_FAILURE');
  });
});
