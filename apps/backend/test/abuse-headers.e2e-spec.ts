import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';

/**
 * Header and parser abuse matrix through the real HTTP pipeline. Every vector
 * must resolve to a safe status with a stable error envelope and no internal
 * leakage — never a 500 (nothing here injects an internal dependency failure).
 * These paths short-circuit at the parser / auth guard / webhook boundary, so no
 * database or JWT is required.
 */
describe('Header & parser abuse (e2e)', () => {
  let app: INestApplication;

  const WEBHOOK = '/api/v1/webhooks/payments/test';
  const PROTECTED = '/api/v1/companies/1/payments';
  const PUBLIC_GET = '/api/v1/health/live';

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

  /** Shared safety assertions for any abusive request. */
  function assertSafe(res: request.Response, allowed: number[]): void {
    expect(allowed).toContain(res.status);
    expect(res.status).not.toBe(500);
    // Error responses (>= 400) must carry the stable failure envelope.
    if (
      res.status >= 400 &&
      res.body &&
      typeof res.body === 'object' &&
      'success' in res.body
    ) {
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error.code).toBe('string');
    }
    const serialized = JSON.stringify(res.body ?? {});
    expect(serialized).not.toMatch(/node_modules|SELECT |INSERT |\bat \//i);
  }

  describe('Authorization header abuse (auth-first, never 500)', () => {
    const badAuth: Array<[string, string]> = [
      ['duplicate joined values', 'Bearer aaa, Bearer bbb'],
      ['basic scheme', 'Basic dXNlcjpwYXNz'],
      ['bare Bearer', 'Bearer'],
      ['scheme without space', 'Bearertoken'],
      ['empty', ''],
      ['not-a-jwt', 'Bearer not.a.jwt'],
    ];
    it.each(badAuth)('rejects %s with 401', async (_label, header) => {
      const res = await request(server())
        .get(PROTECTED)
        .set('Authorization', header);
      assertSafe(res, [401]);
    });
  });

  describe('duplicate sensitive headers do not crash the pipeline', () => {
    it('duplicate Idempotency-Key on a protected write stays a safe 401', async () => {
      const res = await request(server())
        .post('/api/v1/payments')
        .set('Idempotency-Key', ['key-a', 'key-b'] as unknown as string)
        .send({
          bookingId: '11111111-1111-4111-8111-111111111111',
          method: 'BANKILY',
        });
      assertSafe(res, [401]);
    });

    it('duplicate X-Company-Id on a protected read stays a safe 401', async () => {
      const res = await request(server())
        .get('/api/v1/audit-logs')
        .set('X-Company-Id', ['1', '2'] as unknown as string);
      assertSafe(res, [401]);
    });
  });

  describe('spoofed / malformed transport headers are ignored safely', () => {
    it('a changing X-Forwarded-For does not error a public GET', async () => {
      const res = await request(server())
        .get(PUBLIC_GET)
        .set('X-Forwarded-For', '10.0.0.1, 8.8.8.8, evil');
      assertSafe(res, [200, 204]);
    });

    it('a malformed Origin does not error the request', async () => {
      const res = await request(server())
        .get(PUBLIC_GET)
        .set('Origin', 'not a valid origin://<script>');
      assertSafe(res, [200, 204]);
    });
  });

  describe('body / parser limits', () => {
    it('rejects an oversized URL-encoded body with 413', async () => {
      const huge = 'x'.repeat(200 * 1024);
      const res = await request(server())
        .post(WEBHOOK)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`blob=${huge}`);
      assertSafe(res, [413]);
    });

    it('handles a deeply nested JSON body without a 500', async () => {
      let nested: unknown = 'leaf';
      for (let i = 0; i < 2000; i += 1) nested = { n: nested };
      const res = await request(server())
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ eventId: 'e', deep: nested }));
      // No signature → safe 400 (or 413 if the payload exceeds the body limit).
      assertSafe(res, [400, 413]);
    });

    it('rejects malformed JSON with a safe 400 envelope', async () => {
      const res = await request(server())
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .send('{ "eventId": ');
      assertSafe(res, [400]);
    });
  });

  describe('webhook payload abuse (public boundary)', () => {
    it('rejects an invalid signature with WEBHOOK_SIGNATURE_INVALID', async () => {
      const res = await request(server())
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .set('x-voyagi-signature', 'deadbeef')
        .send({
          eventId: 'e',
          internalReference: 'PAY-x',
          outcome: 'SUCCEEDED',
        });
      assertSafe(res, [400]);
      expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    });

    it('rejects a structurally malformed (but valid-JSON) webhook payload', async () => {
      const res = await request(server())
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .send({ not: 'a webhook', nested: { deep: [1, 2, 3] } });
      assertSafe(res, [400]);
    });

    it('rejects an unknown provider with 404 (no auth leak)', async () => {
      const res = await request(server())
        .post('/api/v1/webhooks/payments/unknown-provider')
        .set('x-voyagi-signature', 'x')
        .send({ eventId: 'e' });
      assertSafe(res, [404]);
    });
  });
});
