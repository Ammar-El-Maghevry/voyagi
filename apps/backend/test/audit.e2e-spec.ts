import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { AUDIT_REPOSITORY } from '../src/modules/audit/audit.repository';
import { AUTH_KEY_RESOLVER } from '../src/modules/auth/jwks-key-resolver.provider';
import { IDENTITY_REPOSITORY } from '../src/modules/identity/identity.repository';
import { MembershipRole } from '../src/modules/identity/membership-role';
import {
  generateTestKey,
  localJwksResolver,
  signTestToken,
  type TestSigningKey,
} from './support/auth-test-keys';
import { InMemoryAuditRepository } from './support/in-memory-audit.repository';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';

describe('Audit logs (e2e)', () => {
  const ISSUER = 'http://127.0.0.1:54321/auth/v1';
  const AUDIENCE = 'authenticated';
  const MANAGER = '11111111-1111-4111-8111-111111111111';
  const EMPLOYEE = '22222222-2222-4222-8222-222222222222';
  const OUTSIDER = '33333333-3333-4333-8333-333333333333';
  const base = '/api/v1/audit-logs';

  let app: INestApplication;
  let key: TestSigningKey;

  const auth = (subject: string) =>
    signTestToken(key, { issuer: ISSUER, audience: AUDIENCE, subject }).then(
      (token) => `Bearer ${token}`,
    );
  const scoped = (req: request.Test, token: string, companyId = '10') =>
    req.set('Authorization', token).set('X-Company-Id', companyId);

  beforeAll(async () => {
    key = await generateTestKey('audit-e2e', 'ES256');
    const identity = new InMemoryIdentityRepository();
    const audit = new InMemoryAuditRepository();
    const now = new Date('2026-01-01T00:00:00.000Z');

    identity.addCompany('10', 'Voyagi');
    identity.addCompany('20', 'Other');
    identity.addProfile(MANAGER, 'Manager');
    identity.addProfile(EMPLOYEE, 'Employee');
    identity.addProfile(OUTSIDER, 'Outsider');
    identity.addMembership({ id: '100', userId: MANAGER, companyId: '10', role: MembershipRole.CompanyManager });
    identity.addMembership({ id: '101', userId: EMPLOYEE, companyId: '10', role: MembershipRole.BranchEmployee });
    identity.addMembership({ id: '200', userId: OUTSIDER, companyId: '20', role: MembershipRole.CompanyManager });
    audit.addLog({
      id: '1', actorUserId: MANAGER, companyId: '10', action: 'BOOKING_CREATED',
      entityType: 'booking', entityId: '100', oldValues: null, newValues: { status: 'CONFIRMED' },
      requestId: 'request-1', correlationId: 'correlation-1', createdAt: now,
      // Deliberately present in persistence-shaped test data; the DTO must not expose it.
      ipAddress: '192.0.2.1', deviceFingerprint: 'private-device',
    } as never);
    audit.addLog({
      id: '2', actorUserId: MANAGER, companyId: '10', action: 'BOOKING_CANCELLED',
      entityType: 'booking', entityId: '101', oldValues: { status: 'CONFIRMED' }, newValues: { status: 'CANCELLED' },
      requestId: null, correlationId: null, createdAt: now,
    });
    audit.addLog({
      id: '3', actorUserId: OUTSIDER, companyId: '20', action: 'BOOKING_CREATED',
      entityType: 'booking', entityId: '200', oldValues: null, newValues: null,
      requestId: null, correlationId: null, createdAt: now,
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_KEY_RESOLVER).useValue(localJwksResolver(key))
      .overrideProvider(IDENTITY_REPOSITORY).useValue(identity)
      .overrideProvider(AUDIT_REPOSITORY).useValue(audit)
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => app.close());

  it('requires authentication, tenant membership, and audit.read', async () => {
    expect((await request(app.getHttpServer()).get(base).set('X-Company-Id', '10')).status).toBe(401);
    expect((await scoped(request(app.getHttpServer()).get(base), await auth(OUTSIDER))).status).toBe(403);
    expect((await scoped(request(app.getHttpServer()).get(base), await auth(EMPLOYEE))).status).toBe(403);
  });

  it('returns only the selected company in a paginated response and allowlists audit DTO fields', async () => {
    const response = await scoped(
      request(app.getHttpServer()).get(`${base}?page=1&pageSize=1`),
      await auth(MANAGER),
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, meta: { page: 1, pageSize: 1, total: 2, totalPages: 2 } });
    expect(response.body.data[0]).toMatchObject({ id: '1', companyId: '10', action: 'BOOKING_CREATED' });
    expect(response.body.data[0]).not.toHaveProperty('ipAddress');
    expect(response.body.data[0]).not.toHaveProperty('deviceFingerprint');
    expect(Object.keys(response.body.data[0]).sort()).toEqual([
      'action', 'actorUserId', 'companyId', 'correlationId', 'createdAt', 'entityId',
      'entityType', 'id', 'newValues', 'oldValues', 'requestId',
    ]);

    const otherCompany = await scoped(request(app.getHttpServer()).get(base), await auth(OUTSIDER), '20');
    expect(otherCompany.status).toBe(200);
    expect(otherCompany.body.data.map((item: { companyId: string }) => item.companyId)).toEqual(['20']);
  });

  it('includes the maintenance, commissions, and audit routes in the OpenAPI document', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth(undefined, 'bearer').build(),
    );
    const paths = Object.keys(document.paths);
    expect(paths).toContain('/api/v1/maintenance-records');
    expect(paths).toContain('/api/v1/agent-commission-transactions');
    expect(paths).toContain('/api/v1/audit-logs');
  });
});
