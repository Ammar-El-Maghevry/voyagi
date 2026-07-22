import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';

/**
 * HTTP-pipeline e2e for Payments & Tickets: proves the routes are registered,
 * the security boundary (auth vs the public webhook), raw-body signature
 * verification, and the standard error envelope — without a database, since each
 * asserted path short-circuits before any repository call.
 */
describe('Payments & Tickets (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // rawBody mirrors production bootstrap so webhook signatures can be verified.
    app = moduleRef.createNestApplication({ bufferLogs: true, rawBody: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const UUID = '11111111-1111-4111-8111-111111111111';

  it('requires authentication to initiate a payment (route registered, secure by default)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .send({ bookingId: UUID, method: 'BANKILY' });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('requires authentication to list company payments', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/companies/1/payments');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('requires authentication to issue tickets', async () => {
    const response = await request(app.getHttpServer()).post(
      `/api/v1/bookings/${UUID}/tickets`,
    );
    expect(response.status).toBe(401);
  });

  it('requires authentication to validate a ticket', async () => {
    const response = await request(app.getHttpServer()).post(
      `/api/v1/companies/1/tickets/${UUID}/validate`,
    );
    expect(response.status).toBe(401);
  });

  it('exposes the webhook publicly but rejects an unknown provider with 404', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/webhooks/payments/nope')
      .set('x-voyagi-signature', 'anything')
      .send({ eventId: 'e1' });
    // Public boundary: not 401. Unknown provider is a safe 404.
    expect(response.status).toBe(404);
  });

  it('rejects a webhook with a missing/invalid signature with 400 and no leakage', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/webhooks/payments/test')
      .set('Content-Type', 'application/json')
      .set('x-voyagi-signature', 'deadbeef')
      .send({ eventId: 'e1', internalReference: 'PAY-x', outcome: 'SUCCEEDED' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    // The response must not echo signature/secret material.
    expect(JSON.stringify(response.body)).not.toContain('deadbeef');
  });

  it('rejects an unsigned webhook with 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/webhooks/payments/test')
      .set('Content-Type', 'application/json')
      .send({ eventId: 'e1', internalReference: 'PAY-x', outcome: 'SUCCEEDED' });
    expect(response.status).toBe(400);
  });
});
