import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { AUTH_KEY_RESOLVER } from '../src/modules/auth/jwks-key-resolver.provider';
import { AUTHORIZATION_CONTEXT_RESOLVER } from '../src/modules/authorization/authorization-context-resolver';
import { DatabaseAuthorizationContextResolver } from '../src/modules/identity/database-authorization-context.resolver';
import { IDENTITY_REPOSITORY } from '../src/modules/identity/identity.repository';
import { MembershipRole } from '../src/modules/identity/membership-role';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';
import {
  generateTestKey,
  localJwksResolver,
  signTestToken,
  type TestSigningKey,
} from './support/auth-test-keys';

/**
 * End-to-end coverage of the identity module through the full HTTP stack
 * (rate limit → authentication → authorization → controller → service →
 * repository). Tokens are verified against an in-memory JWKS, and the identity
 * repository is an in-memory fake, so the real database driver is not required
 * while the whole authorization pipeline and the database-backed resolver are
 * exercised end to end.
 */
describe('Identity (e2e)', () => {
  const ISSUER = 'http://127.0.0.1:54321/auth/v1';
  const AUDIENCE = 'authenticated';

  // Distinct UUID subjects (the service requires a UUID auth id).
  const MANAGER = '11111111-1111-4111-8111-111111111111';
  const AGENT = '22222222-2222-4222-8222-222222222222';
  const NO_PROFILE = '33333333-3333-4333-8333-333333333333';
  const INACTIVE = '44444444-4444-4444-8444-444444444444';

  let app: INestApplication;
  let key: TestSigningKey;
  let repo: InMemoryIdentityRepository;

  const tokenFor = (subject: string) =>
    signTestToken(key, { issuer: ISSUER, audience: AUDIENCE, subject });

  const auth = (subject: string) =>
    tokenFor(subject).then((t) => `Bearer ${t}`);

  beforeAll(async () => {
    key = await generateTestKey('identity-e2e', 'ES256');
    repo = new InMemoryIdentityRepository();

    // Company 10 ("Voyagi"): manager + agent + an inactive member.
    repo.addCompany('10', 'Voyagi');
    repo.addCompany('20', 'Other Co');
    repo.addProfile(MANAGER, 'Manager Mona');
    repo.addProfile(AGENT, 'Agent Ali');
    repo.addProfile(INACTIVE, 'Inactive Ivan');
    repo.addMembership({ id: '100', userId: MANAGER, companyId: '10', role: MembershipRole.CompanyManager });
    repo.addMembership({ id: '101', userId: AGENT, companyId: '10', role: MembershipRole.Agent, branchId: '5' });
    repo.addMembership({ id: '102', userId: INACTIVE, companyId: '10', role: MembershipRole.CompanyManager, isActive: false });
    // A membership in a different company, to probe cross-tenant reads.
    repo.addMembership({ id: '200', userId: MANAGER, companyId: '20', role: MembershipRole.CompanyManager });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_KEY_RESOLVER)
      .useValue(localJwksResolver(key))
      .overrideProvider(IDENTITY_REPOSITORY)
      .useValue(repo)
      .compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('binds the database-backed resolver as the effective production resolver', () => {
    // Resolve the token from the AppModule injector — the exact context the
    // global authorization guard is constructed in — where the Phase 5 override
    // replaces the authorization module's permission-less default. (The
    // behavioural tests below confirm the guard grants database-derived
    // permissions, which the default resolver never does.)
    const resolver = app
      .select(AppModule)
      .get(AUTHORIZATION_CONTEXT_RESOLVER, { strict: true });
    expect(resolver).toBeInstanceOf(DatabaseAuthorizationContextResolver);
  });

  describe('GET /api/v1/profiles/me', () => {
    it('rejects an unauthenticated request (401)', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/profiles/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns the profile for an authenticated user (200)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/profiles/me')
        .set('Authorization', await auth(MANAGER));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        data: { id: MANAGER, fullName: 'Manager Mona', isActive: true },
      });
    });

    it('returns 404 when the user has no backend profile', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/profiles/me')
        .set('Authorization', await auth(NO_PROFILE));

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/profiles/me', () => {
    it('updates allowed fields (200)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/profiles/me')
        .set('Authorization', await auth(AGENT))
        .send({ phoneNumber: '+22299887766' });

      expect(res.status).toBe(200);
      expect(res.body.data.phoneNumber).toBe('+22299887766');
    });

    it('rejects an unknown field (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/profiles/me')
        .set('Authorization', await auth(AGENT))
        .send({ isActive: false });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an empty update (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/profiles/me')
        .set('Authorization', await auth(AGENT))
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/profiles/me/companies', () => {
    it('lists the caller companies with pagination meta', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/profiles/me/companies')
        .set('Authorization', await auth(MANAGER));

      expect(res.status).toBe(200);
      // Exact documented collection contract (14-api-design-standards.md §6.2).
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toEqual({
        page: 1,
        pageSize: 20,
        total: 2,
        totalPages: 1,
      });
      expect(typeof res.body.requestId).toBe('string');
      const companyIds = res.body.data.map((c: { companyId: string }) => c.companyId);
      expect(companyIds.sort()).toEqual(['10', '20']);
    });
  });

  describe('GET /api/v1/companies/:companyId/memberships', () => {
    it('allows a member holding memberships.read (200)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/memberships')
        .set('Authorization', await auth(MANAGER));

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
    });

    it('denies a member without the permission (403)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/memberships')
        .set('Authorization', await auth(AGENT));

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('denies a caller with no membership in the company (403)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/20/memberships')
        .set('Authorization', await auth(AGENT));

      expect(res.status).toBe(403);
    });

    it('denies an inactive membership (403)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/memberships')
        .set('Authorization', await auth(INACTIVE));

      expect(res.status).toBe(403);
    });

    it('denies a user with no profile (403, fail closed)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/memberships')
        .set('Authorization', await auth(NO_PROFILE));

      expect(res.status).toBe(403);
    });

    it('does not leak the missing permission name or internals in the body', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/memberships')
        .set('Authorization', await auth(AGENT));

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('memberships.read');
      expect(body).not.toMatch(/at .*\(.*\.ts/);
      expect(res.body.error).not.toHaveProperty('stack');
    });
  });

  describe('GET /api/v1/companies/:companyId/memberships/:membershipId', () => {
    it('returns a membership within the company (200)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/memberships/101')
        .set('Authorization', await auth(MANAGER));

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: '101', companyId: '10' });
    });

    it('returns 404 for a membership that belongs to another company', async () => {
      // Membership 200 belongs to company 20; addressing it under company 10
      // must not reveal its existence.
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies/10/memberships/200')
        .set('Authorization', await auth(MANAGER));

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
    });
  });

  describe('database failure during authorization (dependency error)', () => {
    it('surfaces a membership-lookup outage as 503, never a 403 denial', async () => {
      // A database outage while resolving the caller's membership must NOT be
      // mistaken for "not authorized": the resolver propagates the failure and
      // it is translated to a dependency error, distinct from a real denial.
      repo.failMembershipsFor(MANAGER);
      try {
        const res = await request(app.getHttpServer())
          .get('/api/v1/companies/10/memberships')
          .set('Authorization', await auth(MANAGER));

        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('DEPENDENCY_FAILURE');
        // Fail closed without masquerading as an authorization decision.
        expect(res.status).not.toBe(403);
      } finally {
        repo.clearFailures();
      }
    });
  });
});
