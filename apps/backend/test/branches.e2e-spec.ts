import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { DatabaseConnectionError } from '../src/infrastructure/database/database.errors';
import { AUTH_KEY_RESOLVER } from '../src/modules/auth/jwks-key-resolver.provider';
import { BRANCHES_REPOSITORY } from '../src/modules/branches/branches.repository';
import { IDENTITY_REPOSITORY } from '../src/modules/identity/identity.repository';
import { MembershipRole } from '../src/modules/identity/membership-role';
import { InMemoryBranchesRepository } from './support/in-memory-branches.repository';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';
import {
  generateTestKey,
  localJwksResolver,
  signTestToken,
  type TestSigningKey,
} from './support/auth-test-keys';

/**
 * End-to-end coverage of the branches module through the full HTTP stack
 * (auth → authorization → branch-entitlement narrowing → controller → service →
 * repository). Auth is verified against an in-memory JWKS and both repositories
 * are in-memory fakes, so the whole pipeline runs without a real database.
 */
describe('Branches (e2e)', () => {
  const ISSUER = 'http://127.0.0.1:54321/auth/v1';
  const AUDIENCE = 'authenticated';

  const MANAGER = '11111111-1111-4111-8111-111111111111';
  const EMPLOYEE = '22222222-2222-4222-8222-222222222222';
  const AGENT = '33333333-3333-4333-8333-333333333333';
  const OUTSIDER = '44444444-4444-4444-8444-444444444444';

  let app: INestApplication;
  let key: TestSigningKey;
  let identityRepo: InMemoryIdentityRepository;
  let branchesRepo: InMemoryBranchesRepository;

  const auth = (subject: string) =>
    signTestToken(key, { issuer: ISSUER, audience: AUDIENCE, subject }).then(
      (t) => `Bearer ${t}`,
    );

  beforeAll(async () => {
    key = await generateTestKey('branches-e2e', 'ES256');
    identityRepo = new InMemoryIdentityRepository();
    branchesRepo = new InMemoryBranchesRepository();

    identityRepo.addCompany('10', 'Voyagi');
    identityRepo.addCompany('20', 'Other Co');
    identityRepo.addProfile(MANAGER, 'Manager Mona');
    identityRepo.addProfile(EMPLOYEE, 'Employee Emma');
    identityRepo.addProfile(AGENT, 'Agent Ali');
    identityRepo.addProfile(OUTSIDER, 'Outsider Omar');
    identityRepo.addMembership({ id: '100', userId: MANAGER, companyId: '10', role: MembershipRole.CompanyManager });
    identityRepo.addMembership({ id: '101', userId: EMPLOYEE, companyId: '10', role: MembershipRole.BranchEmployee, branchId: '1' });
    identityRepo.addMembership({ id: '102', userId: AGENT, companyId: '10', role: MembershipRole.Agent, branchId: '1' });
    // OUTSIDER belongs only to company 20.
    identityRepo.addMembership({ id: '200', userId: OUTSIDER, companyId: '20', role: MembershipRole.CompanyManager });

    branchesRepo.addBranch({ id: '1', companyId: '10', cityId: '5', nameAr: 'فرع1', nameFr: 'Agence1' });
    branchesRepo.addBranch({ id: '2', companyId: '10', cityId: '5', nameAr: 'فرع2', nameFr: 'Agence2' });
    branchesRepo.addBranch({ id: '3', companyId: '20', cityId: '5', nameAr: 'فرع3', nameFr: 'Agence3' });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_KEY_RESOLVER)
      .useValue(localJwksResolver(key))
      .overrideProvider(IDENTITY_REPOSITORY)
      .useValue(identityRepo)
      .overrideProvider(BRANCHES_REPOSITORY)
      .useValue(branchesRepo)
      .compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('authentication & authorization', () => {
    it('rejects an unauthenticated request (401)', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/companies/10/branches');
      expect(res.status).toBe(401);
    });

    it('denies a caller with no membership in the company (403)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/branches')
        .set('Authorization', await auth(OUTSIDER));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('denies create without branches.manage (agent, 403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/companies/10/branches')
        .set('Authorization', await auth(AGENT))
        .send({ cityId: '5', nameAr: 'x', nameFr: 'y' });
      expect(res.status).toBe(403);
    });
  });

  describe('branch-scoped read visibility (entitlement-coupled)', () => {
    it('a company-wide manager lists every company branch', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/branches')
        .set('Authorization', await auth(MANAGER));
      expect(res.status).toBe(200);
      expect(res.body.data.map((b: { id: string }) => b.id).sort()).toEqual(['1', '2']);
      expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
    });

    it('a branch employee lists only their own branch', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/branches')
        .set('Authorization', await auth(EMPLOYEE));
      expect(res.status).toBe(200);
      expect(res.body.data.map((b: { id: string }) => b.id)).toEqual(['1']);
    });

    it('the employee can read their own branch (200)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/branches/1')
        .set('Authorization', await auth(EMPLOYEE));
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('1');
    });

    it('the employee cannot read a sibling branch (404, not visible)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/branches/2')
        .set('Authorization', await auth(EMPLOYEE));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('the manager can read any company branch (200)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/branches/2')
        .set('Authorization', await auth(MANAGER));
      expect(res.status).toBe(200);
    });

    it('a branch id from another company is not found under this company (404)', async () => {
      // Branch 3 belongs to company 20; addressing it under company 10 must not
      // reveal it, even to a company-wide manager of company 10.
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/branches/3')
        .set('Authorization', await auth(MANAGER));
      expect(res.status).toBe(404);
    });
  });

  describe('management (branches.manage)', () => {
    it('creates a branch (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/companies/10/branches')
        .set('Authorization', await auth(MANAGER))
        .send({ cityId: '5', nameAr: 'جديد', nameFr: 'Nouveau', phone: '+22212345678' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ companyId: '10', nameFr: 'Nouveau', isActive: true });
    });

    it('rejects a duplicate branch name (409)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/companies/10/branches')
        .set('Authorization', await auth(MANAGER))
        .send({ cityId: '5', nameAr: 'فرع1', nameFr: 'Agence1' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('rejects an invalid body (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/companies/10/branches')
        .set('Authorization', await auth(MANAGER))
        .send({ cityId: '5', nameAr: 'only-arabic' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('updates a branch (200)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/companies/10/branches/1')
        .set('Authorization', await auth(MANAGER))
        .send({ nameFr: 'Agence Un' });
      expect(res.status).toBe(200);
      expect(res.body.data.nameFr).toBe('Agence Un');
    });

    it('rejects an empty update (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/companies/10/branches/1')
        .set('Authorization', await auth(MANAGER))
        .send({});
      expect(res.status).toBe(400);
    });

    it('deactivates, rejects a redundant deactivate (409), then reactivates', async () => {
      const off = await request(app.getHttpServer())
        .post('/api/v1/companies/10/branches/2/deactivate')
        .set('Authorization', await auth(MANAGER));
      expect(off.status).toBe(200);
      expect(off.body.data.isActive).toBe(false);

      const again = await request(app.getHttpServer())
        .post('/api/v1/companies/10/branches/2/deactivate')
        .set('Authorization', await auth(MANAGER));
      expect(again.status).toBe(409);

      const on = await request(app.getHttpServer())
        .post('/api/v1/companies/10/branches/2/activate')
        .set('Authorization', await auth(MANAGER));
      expect(on.status).toBe(200);
      expect(on.body.data.isActive).toBe(true);
    });

    it('returns 404 when updating a branch in another company', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/companies/10/branches/3')
        .set('Authorization', await auth(MANAGER))
        .send({ nameFr: 'x' });
      expect(res.status).toBe(404);
    });
  });

  describe('dependency failure', () => {
    it('surfaces a repository outage as 503, never a denial', async () => {
      branchesRepo.failNextWith(new DatabaseConnectionError());
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/branches')
        .set('Authorization', await auth(MANAGER));
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DEPENDENCY_FAILURE');
    });

    it('does not leak SQL or stack traces in error bodies', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/branches/2')
        .set('Authorization', await auth(EMPLOYEE));
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/SELECT|FROM public\./i);
      expect(res.body.error).not.toHaveProperty('stack');
    });
  });
});
