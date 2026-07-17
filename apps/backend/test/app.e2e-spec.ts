import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';

describe('Application (e2e)', () => {
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

  it('bootstraps the application successfully', () => {
    expect(app).toBeDefined();
    expect(app.getHttpServer()).toBeDefined();
  });

  it('returns the standard error envelope for an unknown route (404)', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/unknown-route',
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'RESOURCE_NOT_FOUND' },
      path: '/api/v1/unknown-route',
    });
    expect(typeof response.body.requestId).toBe('string');
    expect(typeof response.body.timestamp).toBe('string');
  });

  it('does not expose stack traces in error responses', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/unknown-route',
    );

    expect(JSON.stringify(response.body)).not.toMatch(/at .*\(.*\.ts/);
    expect(response.body.error).not.toHaveProperty('stack');
  });
});
