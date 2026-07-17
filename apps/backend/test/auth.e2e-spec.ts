import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { AUTH_KEY_RESOLVER } from '../src/modules/auth/jwks-key-resolver.provider';
import {
  generateTestKey,
  localJwksResolver,
  signTestToken,
  type TestSigningKey,
} from './support/auth-test-keys';

/**
 * End-to-end coverage of the global authentication guard through the full HTTP
 * stack. The remote JWKS resolver is replaced with an in-memory JWKS built from
 * a locally generated key, so tokens are verified deterministically without any
 * network or real Supabase dependency. Tokens are signed to match the config's
 * default issuer/audience (local Supabase URL, `authenticated`).
 */
describe('Authentication (e2e)', () => {
  // Must match the auth config defaults used in the test environment.
  const ISSUER = 'http://127.0.0.1:54321/auth/v1';
  const AUDIENCE = 'authenticated';

  let app: INestApplication;
  let key: TestSigningKey;

  const sign = (options: Partial<Parameters<typeof signTestToken>[1]> = {}) =>
    signTestToken(key, {
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: 'user-123',
      ...options,
    });

  beforeAll(async () => {
    key = await generateTestKey('e2e-key', 'ES256');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_KEY_RESOLVER)
      .useValue(localJwksResolver(key))
      .compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('protected route: GET /api/v1/auth/me', () => {
    it('returns the verified principal for a valid Bearer token (200)', async () => {
      const token = await sign({
        claims: { email: 'traveller@example.com' },
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        data: {
          userId: 'user-123',
          email: 'traveller@example.com',
          role: 'authenticated',
        },
      });
      expect(typeof response.body.data.expiresAt).toBe('number');
      expect(typeof response.body.requestId).toBe('string');
    });

    it('never leaks raw claims or the token in the response', async () => {
      const token = await sign({
        claims: { email: 'traveller@example.com', session_id: 'sess-1' },
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      const body = JSON.stringify(response.body);
      // Session id is an internal claim, not part of the safe response DTO.
      expect(body).not.toContain('sess-1');
      expect(body).not.toContain(token);
    });

    it('rejects a request with no credentials (401 UNAUTHENTICATED)', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/auth/me',
      );

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        success: false,
        error: { code: 'UNAUTHENTICATED' },
        path: '/api/v1/auth/me',
      });
      expect(typeof response.body.requestId).toBe('string');
    });

    it('rejects a malformed Authorization header (401 UNAUTHENTICATED)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Token abc.def.ghi');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a structurally invalid token (401 TOKEN_INVALID)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not-a-real-jwt');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('TOKEN_INVALID');
    });

    it('rejects a token signed by an unknown key (401 TOKEN_INVALID)', async () => {
      const foreignKey = await generateTestKey('foreign', 'ES256');
      const token = await signTestToken(foreignKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
        subject: 'user-123',
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('TOKEN_INVALID');
    });

    it('distinguishes an expired token (401 TOKEN_EXPIRED)', async () => {
      // Absolute epoch well in the past (beyond the clock-tolerance window).
      const token = await sign({
        expiresIn: Math.floor(Date.now() / 1000) - 3600,
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('TOKEN_EXPIRED');
    });

    it('rejects a token with the wrong issuer (401 TOKEN_INVALID)', async () => {
      const token = await sign({ issuer: 'https://evil.example.com/auth/v1' });

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('TOKEN_INVALID');
    });

    it('rejects a token with the wrong audience (401 TOKEN_INVALID)', async () => {
      const token = await sign({ audience: 'some-other-service' });

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('TOKEN_INVALID');
    });

    it('never exposes stack traces on authentication failure', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not-a-real-jwt');

      expect(JSON.stringify(response.body)).not.toMatch(/at .*\(.*\.ts/);
      expect(response.body.error).not.toHaveProperty('stack');
    });
  });

  describe('public routes remain accessible without credentials', () => {
    it('GET /api/v1/health/live -> 200 without a token', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/live',
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('unknown routes still 404 (not 401) so auth is not a catch-all', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/unknown-route')
        .set('Authorization', `Bearer ${await sign()}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
    });
  });
});
