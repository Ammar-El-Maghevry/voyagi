import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { PAYMENT_PROVIDERS } from '../src/modules/payments/payment-provider.port';

/**
 * Provider-disabled e2e (Phase 18.1): with NO payment provider registered (the
 * production default), the public payment webhook route must fail safely with a
 * stable 503 PAYMENT_PROVIDER_UNAVAILABLE before any signature verification,
 * database access or state mutation — and must not leak configuration.
 */
describe('Payments disabled (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Simulate the production default: no provider adapter is registered.
      .overrideProvider(PAYMENT_PROVIDERS)
      .useValue([])
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true, rawBody: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('fails a webhook with 503 provider-unavailable when payments are disabled', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/webhooks/payments/test')
      .set('Content-Type', 'application/json')
      .set('x-voyagi-signature', 'anything')
      .send({
        eventId: 'e1',
        internalReference: 'PAY-x',
        outcome: 'SUCCEEDED',
      });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    // No configuration or signature material leaks.
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('anything');
    expect(serialized.toLowerCase()).not.toMatch(
      /secret|provider_mode|adapter/,
    );
  });
});
