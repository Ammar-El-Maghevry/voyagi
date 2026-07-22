import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { AUTH_KEY_RESOLVER } from '../src/modules/auth/jwks-key-resolver.provider';
import { CommissionStatus } from '../src/modules/commissions/commission-status';
import { COMMISSIONS_REPOSITORY } from '../src/modules/commissions/commissions.repository';
import { IDENTITY_REPOSITORY } from '../src/modules/identity/identity.repository';
import { MembershipRole } from '../src/modules/identity/membership-role';
import {
  generateTestKey,
  localJwksResolver,
  signTestToken,
  type TestSigningKey,
} from './support/auth-test-keys';
import { InMemoryCommissionsRepository } from './support/in-memory-commissions.repository';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';

describe('Agent commissions (e2e)', () => {
  const ISSUER = 'http://127.0.0.1:54321/auth/v1';
  const AUDIENCE = 'authenticated';
  const MANAGER = '11111111-1111-4111-8111-111111111111';
  const AGENT = '22222222-2222-4222-8222-222222222222';
  const EMPLOYEE = '33333333-3333-4333-8333-333333333333';
  const OUTSIDER = '44444444-4444-4444-8444-444444444444';
  const base = '/api/v1/agent-commission-transactions';

  let app: INestApplication;
  let key: TestSigningKey;

  const auth = (subject: string) =>
    signTestToken(key, { issuer: ISSUER, audience: AUDIENCE, subject }).then(
      (token) => `Bearer ${token}`,
    );
  const scoped = (req: request.Test, token: string, companyId = '10') =>
    req.set('Authorization', token).set('X-Company-Id', companyId);

  beforeAll(async () => {
    key = await generateTestKey('commissions-e2e', 'ES256');
    const identity = new InMemoryIdentityRepository();
    const commissions = new InMemoryCommissionsRepository();
    const now = new Date('2026-01-01T00:00:00.000Z');

    identity.addCompany('10', 'Voyagi');
    identity.addCompany('20', 'Other');
    identity.addProfile(MANAGER, 'Manager');
    identity.addProfile(AGENT, 'Agent');
    identity.addProfile(EMPLOYEE, 'Employee');
    identity.addProfile(OUTSIDER, 'Outsider');
    identity.addMembership({ id: '100', userId: MANAGER, companyId: '10', role: MembershipRole.CompanyManager });
    identity.addMembership({ id: '101', userId: AGENT, companyId: '10', role: MembershipRole.Agent });
    identity.addMembership({ id: '102', userId: EMPLOYEE, companyId: '10', role: MembershipRole.BranchEmployee });
    identity.addMembership({ id: '200', userId: OUTSIDER, companyId: '20', role: MembershipRole.CompanyManager });
    commissions.addMembership(MANAGER, { id: '100', role: MembershipRole.CompanyManager });
    commissions.addMembership(AGENT, { id: '101', role: MembershipRole.Agent });
    commissions.addMembership(OUTSIDER, { id: '200', role: MembershipRole.CompanyManager });
    for (const [id, companyId, agentMembershipId, bookingId] of [
      ['1', '10', '101', '1001'],
      ['2', '10', '999', '1002'],
      ['3', '20', '200', '2001'],
    ]) {
      commissions.addTransaction({
        id, companyId, agentMembershipId, bookingId, commissionRate: '10.00',
        baseAmount: '100.00', commissionAmount: '10.00', currency: 'MRU',
        status: CommissionStatus.Earned, earnedAt: now, createdAt: now, updatedAt: now,
      });
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_KEY_RESOLVER).useValue(localJwksResolver(key))
      .overrideProvider(IDENTITY_REPOSITORY).useValue(identity)
      .overrideProvider(COMMISSIONS_REPOSITORY).useValue(commissions)
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => app.close());

  it('requires authentication, company membership, and commissions.read', async () => {
    expect((await request(app.getHttpServer()).get(base).set('X-Company-Id', '10')).status).toBe(401);
    expect((await scoped(request(app.getHttpServer()).get(base), await auth(OUTSIDER))).status).toBe(403);
    expect((await scoped(request(app.getHttpServer()).get(base), await auth(EMPLOYEE))).status).toBe(403);
  });

  it('limits an agent to their own commission membership and uses the collection envelope', async () => {
    const response = await scoped(request(app.getHttpServer()).get(base), await auth(AGENT));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ id: '1', companyId: '10', agentMembershipId: '101' });
  });

  it('returns only the selected company page and the commission response DTO fields', async () => {
    const response = await scoped(
      request(app.getHttpServer()).get(`${base}?page=2&pageSize=1`),
      await auth(MANAGER),
    );
    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
    expect(response.body.data[0]).toMatchObject({ id: '2', companyId: '10' });
    expect(Object.keys(response.body.data[0]).sort()).toEqual([
      'agentMembershipId', 'baseAmount', 'bookingId', 'commissionAmount', 'commissionRate',
      'companyId', 'createdAt', 'currency', 'earnedAt', 'id', 'status', 'updatedAt',
    ]);

    const otherCompany = await scoped(request(app.getHttpServer()).get(base), await auth(OUTSIDER), '20');
    expect(otherCompany.status).toBe(200);
    expect(otherCompany.body.data.map((item: { companyId: string }) => item.companyId)).toEqual(['20']);
  });
});
