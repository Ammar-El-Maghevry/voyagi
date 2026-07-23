import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';

/**
 * Cross-cutting API hardening proven through the real HTTP pipeline. These paths
 * short-circuit at the body parser / guard / filter, so no database or JWT is
 * required. Authenticated abuse (mass assignment, cross-tenant ID swaps) is
 * covered by the module e2e suites (authorization/bookings/payments/tickets).
 */
describe('API hardening (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true, rawBody: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  describe('cache-control: sensitive responses are never stored', () => {
    it('sets no-store on a public GET', async () => {
      const res = await request(server()).get('/api/v1/health/live');
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('sets no-store even on an unauthenticated 401', async () => {
      const res = await request(server()).get('/api/v1/companies/1/payments');
      expect(res.status).toBe(401);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('sets no-store on a 404', async () => {
      const res = await request(server()).get('/api/v1/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('payload and parser limits', () => {
    it('rejects malformed JSON with a safe 400 envelope', async () => {
      const res = await request(server())
        .post('/api/v1/webhooks/payments/test')
        .set('Content-Type', 'application/json')
        .send('{ this is not json ');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error.code).toBe('string');
    });

    it('rejects an oversized body with 413', async () => {
      const huge = 'x'.repeat(200 * 1024); // > 100kb BODY_LIMIT
      const res = await request(server())
        .post('/api/v1/webhooks/payments/test')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ blob: huge }));
      expect(res.status).toBe(413);
    });
  });

  describe('error envelope never leaks internals', () => {
    it('returns the standard envelope with no stack/SQL on an unknown route', async () => {
      const res = await request(server()).get('/api/v1/nope');
      expect(res.body).toMatchObject({ success: false });
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toMatch(
        /at \/|node_modules|SELECT |INSERT |stack/i,
      );
    });
  });

  describe('public boundary', () => {
    it('keeps the webhook public but rejects an unverified signature (400, no leak)', async () => {
      const res = await request(server())
        .post('/api/v1/webhooks/payments/test')
        .set('Content-Type', 'application/json')
        .set('x-voyagi-signature', 'deadbeef')
        .send({
          eventId: 'e1',
          internalReference: 'PAY-x',
          outcome: 'SUCCEEDED',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
      expect(JSON.stringify(res.body)).not.toContain('deadbeef');
    });

    it('requires auth on sensitive reads (secure by default)', async () => {
      for (const path of [
        '/api/v1/audit-logs',
        '/api/v1/agent-commission-transactions',
        '/api/v1/maintenance-records',
        '/api/v1/tickets',
      ]) {
        const res = await request(server()).get(path);
        expect(res.status).toBe(401);
      }
    });
  });
});
