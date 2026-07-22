import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { TransactionManager } from '../src/infrastructure/database';
import { AUDIT_REPOSITORY } from '../src/modules/audit/audit.repository';
import { AUTH_KEY_RESOLVER } from '../src/modules/auth/jwks-key-resolver.provider';
import { IDENTITY_REPOSITORY } from '../src/modules/identity/identity.repository';
import { MembershipRole } from '../src/modules/identity/membership-role';
import { MaintenanceController } from '../src/modules/maintenance/maintenance.controller';
import { MAINTENANCE_REPOSITORY } from '../src/modules/maintenance/maintenance.repository';
import { MAINTENANCE_SCHEDULING_PORT } from '../src/modules/maintenance/maintenance-scheduling.port';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import { MaintenanceStatus } from '../src/modules/maintenance/maintenance-status';
import { MaintenanceType } from '../src/modules/maintenance/maintenance-type';
import {
  generateTestKey,
  localJwksResolver,
  signTestToken,
  type TestSigningKey,
} from './support/auth-test-keys';
import { InMemoryAuditRepository } from './support/in-memory-audit.repository';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';
import { InMemoryMaintenanceRepository } from './support/in-memory-maintenance.repository';

const inlineTransactions = {
  run: <T>(work: (tx: never) => Promise<T>): Promise<T> => work({} as never),
};

describe('Maintenance records (e2e)', () => {
  const ISSUER = 'http://127.0.0.1:54321/auth/v1';
  const AUDIENCE = 'authenticated';
  const MANAGER = '11111111-1111-4111-8111-111111111111';
  const EMPLOYEE = '22222222-2222-4222-8222-222222222222';
  const OUTSIDER = '33333333-3333-4333-8333-333333333333';
  const base = '/api/v1/maintenance-records';

  let app: INestApplication;
  let moduleRef: TestingModule;
  let key: TestSigningKey;

  const auth = (subject: string) =>
    signTestToken(key, { issuer: ISSUER, audience: AUDIENCE, subject }).then(
      (token) => `Bearer ${token}`,
    );
  const scoped = (req: request.Test, token: string) =>
    req.set('Authorization', token).set('X-Company-Id', '10');

  beforeAll(async () => {
    key = await generateTestKey('maintenance-e2e', 'ES256');
    const identity = new InMemoryIdentityRepository();
    const maintenance = new InMemoryMaintenanceRepository();
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

    maintenance.addBus({ id: '1', companyId: '10' });
    maintenance.addBus({ id: '2', companyId: '10' });
    maintenance.addBus({ id: '4', companyId: '10' });
    maintenance.addBus({ id: '3', companyId: '20' });
    maintenance.addRecord({
      id: '10', companyId: '10', busId: '1', maintenanceType: MaintenanceType.Inspection,
      status: MaintenanceStatus.Scheduled, startedAt: now,
      scheduledEndsAt: new Date('2026-01-01T02:00:00.000Z'), createdAt: now, updatedAt: now,
    });
    maintenance.addRecord({
      id: '11', companyId: '10', busId: '2', maintenanceType: MaintenanceType.GeneralService,
      status: MaintenanceStatus.Completed, startedAt: now,
      scheduledEndsAt: new Date('2026-01-01T03:00:00.000Z'), createdAt: now, updatedAt: now,
    });
    maintenance.addRecord({
      id: '20', companyId: '20', busId: '3', maintenanceType: MaintenanceType.GeneralService,
      status: MaintenanceStatus.Scheduled, startedAt: now,
      scheduledEndsAt: new Date('2026-01-01T02:00:00.000Z'), createdAt: now, updatedAt: now,
    });

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_KEY_RESOLVER).useValue(localJwksResolver(key))
      .overrideProvider(IDENTITY_REPOSITORY).useValue(identity)
      .overrideProvider(MAINTENANCE_REPOSITORY).useValue(maintenance)
      .overrideProvider(AUDIT_REPOSITORY).useValue(audit)
      .overrideProvider(TransactionManager).useValue(inlineTransactions)
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => app.close());

  it('requires authentication and an authorized company membership', async () => {
    expect((await request(app.getHttpServer()).get(base).set('X-Company-Id', '10')).status).toBe(401);
    expect((await scoped(request(app.getHttpServer()).get(base), await auth(OUTSIDER))).status).toBe(403);
  });

  it('allows maintenance readers to list their company records in the paginated envelope', async () => {
    const response = await scoped(
      request(app.getHttpServer()).get(`${base}?page=2&pageSize=1`),
      await auth(EMPLOYEE),
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, meta: { page: 2, pageSize: 1, total: 2, totalPages: 2 } });
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ id: '11', companyId: '10' });
    expect(Object.keys(response.body.data[0]).sort()).toEqual([
      'busId', 'companyId', 'createdAt', 'id', 'maintenanceType', 'scheduledEndsAt',
      'startedAt', 'status', 'updatedAt',
    ]);
  });

  it('denies maintenance writes without maintenance.manage', async () => {
    const response = await scoped(
      request(app.getHttpServer()).post(base).send({
        busId: '1', maintenanceType: MaintenanceType.Inspection,
        startedAt: '2026-04-01T08:00:00.000Z', scheduledEndsAt: '2026-04-01T10:00:00.000Z',
      }),
      await auth(EMPLOYEE),
    );
    expect(response.status).toBe(403);
  });

  it('creates and transitions a company-scoped record as a manager', async () => {
    const created = await scoped(
      request(app.getHttpServer()).post(base).send({
        busId: '4', maintenanceType: MaintenanceType.Inspection, description: 'Quarterly check',
        startedAt: '2026-04-01T08:00:00.000Z', scheduledEndsAt: '2026-04-01T10:00:00.000Z',
      }),
      await auth(MANAGER),
    );
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ companyId: '10', busId: '4', status: 'SCHEDULED' });

    const started = await scoped(
      request(app.getHttpServer()).patch(`${base}/${created.body.data.id}`).send({ action: 'start' }),
      await auth(MANAGER),
    );
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe('IN_PROGRESS');
  });

  it('rejects fields outside the maintenance creation DTO allowlist', async () => {
    const response = await scoped(
      request(app.getHttpServer()).post(base).send({
        busId: '2', maintenanceType: MaintenanceType.Inspection,
        startedAt: '2026-05-01T08:00:00.000Z', scheduledEndsAt: '2026-05-01T10:00:00.000Z',
        status: 'COMPLETED',
      }),
      await auth(MANAGER),
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('wires the controller, service, and maintenance scheduling port', () => {
    const options = { strict: false } as const;
    expect(moduleRef.get(MaintenanceController, options)).toBeInstanceOf(MaintenanceController);
    const service = moduleRef.get(MaintenanceService, options);
    expect(service).toBeInstanceOf(MaintenanceService);
    expect(moduleRef.get(MAINTENANCE_SCHEDULING_PORT, options)).toBe(service);
  });
});
