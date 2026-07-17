import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { DatabaseReadinessIndicator } from '../src/infrastructure/database';
import type {
  ReadinessIndicator,
  ReadinessResult,
} from '../src/modules/health/readiness-indicator';

/**
 * Deterministic, database-independent coverage of both readiness branches.
 *
 * The real database readiness indicator is replaced with a stub so the
 * healthy/unavailable paths are exercised through the full HTTP → controller →
 * envelope/filter stack regardless of whether a database is reachable. Real
 * database connectivity is covered by the integration suite.
 */
function stubIndicator(result: ReadinessResult): ReadinessIndicator {
  return { name: 'database', check: async () => result };
}

async function bootWithIndicator(
  result: ReadinessResult,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseReadinessIndicator)
    .useValue(stubIndicator(result))
    .compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app as never);
  await app.init();
  return app;
}

describe('Database readiness (e2e, stubbed)', () => {
  describe('when the database is available', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootWithIndicator({ status: 'up' });
    });
    afterAll(async () => {
      await app.close();
    });

    it('reports readiness healthy (200) with the database check up', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/ready',
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        data: { status: 'ok', checks: { database: 'up' } },
      });
      expect(typeof response.body.requestId).toBe('string');
    });

    it('keeps liveness healthy (200)', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/live',
      );
      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('ok');
    });
  });

  describe('when the database is unavailable', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootWithIndicator({
        status: 'down',
        detail: 'Database is not reachable.',
      });
    });
    afterAll(async () => {
      await app.close();
    });

    it('reports readiness unavailable (503) with the standard error envelope', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/ready',
      );

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        success: false,
        error: { code: 'DEPENDENCY_FAILURE' },
        path: '/api/v1/health/ready',
      });
      expect(typeof response.body.requestId).toBe('string');
    });

    it('does not leak connection details in the error response', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/ready',
      );
      const body = JSON.stringify(response.body);
      expect(body).not.toMatch(/postgres(ql)?:\/\//);
      expect(body).not.toContain('54322');
      expect(body).not.toContain('password');
    });

    it('keeps liveness healthy (200) despite the database being down', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/live',
      );
      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('ok');
    });
  });
});
