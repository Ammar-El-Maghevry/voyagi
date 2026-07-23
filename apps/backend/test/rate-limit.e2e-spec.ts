import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

/**
 * Per-category rate-limit enforcement through the real pipeline. The category
 * limits are `@Throttle` values baked at class-decoration time, so the stricter
 * test values must be set in the environment BEFORE the app module is imported —
 * hence the dynamic import inside `beforeAll`. The webhook category is used
 * because it is public (no JWT needed) yet still keyed per caller by the
 * IdentityThrottlerGuard.
 */
describe('Rate limiting (e2e)', () => {
  let app: INestApplication;

  const WEBHOOK = '/api/v1/webhooks/payments/test';
  const body = {
    eventId: 'e',
    internalReference: 'PAY-x',
    outcome: 'SUCCEEDED',
  };

  beforeAll(async () => {
    process.env.RATE_LIMIT_TTL = '2000';
    process.env.RATE_LIMIT_WEBHOOK = '3';
    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/bootstrap/configure-app');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true, rawBody: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.RATE_LIMIT_TTL;
    delete process.env.RATE_LIMIT_WEBHOOK;
  });

  /** Post with a caller identity (distinct Authorization → distinct bucket). */
  const post = (token?: string) => {
    const req = request(app.getHttpServer())
      .post(WEBHOOK)
      .set('Content-Type', 'application/json');
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(
      body,
    );
  };

  it('enforces the configured webhook limit and returns a stable 429 envelope', async () => {
    const id = 'client-enforce';
    for (let i = 0; i < 3; i += 1) {
      const res = await post(id);
      expect(res.status).toBe(400); // allowed through (bad signature), not throttled
    }
    const limited = await post(id);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    // No key material or configuration leaks in the response.
    const serialized = JSON.stringify(limited.body);
    expect(serialized).not.toMatch(/tok:|net:|RATE_LIMIT_WEBHOOK|Bearer/i);
  });

  it('keeps separate callers in separate buckets', async () => {
    // A different Authorization identity has its own fresh budget.
    for (let i = 0; i < 3; i += 1) {
      expect((await post('client-separate')).status).toBe(400);
    }
    expect((await post('client-separate')).status).toBe(429);
    // A brand-new identity is unaffected by the exhausted one.
    expect((await post('client-fresh')).status).toBe(400);
  });

  it('does not let spoofed forwarding headers bypass the limit', async () => {
    const send = (xff: string) =>
      request(app.getHttpServer())
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', xff)
        .send(body);
    // Trust proxy is disabled, so a changing X-Forwarded-For is the same bucket.
    for (let i = 0; i < 3; i += 1) {
      expect((await send(`10.0.0.${i}`)).status).toBe(400);
    }
    expect((await send('10.0.0.99')).status).toBe(429);
  });

  it('resets after the configured window', async () => {
    const id = 'client-reset';
    for (let i = 0; i < 3; i += 1) await post(id);
    expect((await post(id)).status).toBe(429);
    await new Promise((r) => setTimeout(r, 2200)); // > RATE_LIMIT_TTL
    expect((await post(id)).status).toBe(400); // window reset, allowed again
  });
});
