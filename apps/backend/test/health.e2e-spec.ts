import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { REQUEST_ID_HEADER } from '../src/common/constants/request.constants';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health/live -> 200 with success envelope', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/health/live',
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { status: 'ok' },
    });
    expect(typeof response.body.requestId).toBe('string');
    expect(response.body.requestId.length).toBeGreaterThan(0);
  });

  // Environment-tolerant: the real app reports readiness based on actual
  // database availability. Both branches return a compliant envelope with a
  // request id. Strict up/down mapping is covered deterministically in
  // database-readiness.e2e-spec.ts.
  it('GET /api/v1/health/ready -> compliant envelope reflecting DB state', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/health/ready',
    );

    expect([200, 503]).toContain(response.status);
    expect(typeof response.body.requestId).toBe('string');
    if (response.status === 200) {
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('ok');
      expect(typeof response.body.data.checks).toBe('object');
    } else {
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('DEPENDENCY_FAILURE');
    }
  });

  it('echoes the X-Request-Id response header', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/health/live',
    );

    expect(response.headers[REQUEST_ID_HEADER]).toBeDefined();
    expect(response.headers[REQUEST_ID_HEADER]).toBe(response.body.requestId);
  });

  it('accepts a valid incoming X-Request-Id and reuses it', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set(REQUEST_ID_HEADER, 'client-correlation-1');

    expect(response.headers[REQUEST_ID_HEADER]).toBe('client-correlation-1');
    expect(response.body.requestId).toBe('client-correlation-1');
  });

  it('sets security headers and hides the framework fingerprint', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/health/live',
    );

    // Set by Helmet.
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    // x-powered-by is explicitly disabled.
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
