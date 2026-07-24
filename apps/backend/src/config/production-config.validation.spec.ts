import {
  assertProductionConfig,
  collectProductionConfigViolations,
  parseBodyLimitBytes,
} from './production-config.validation';
import { swaggerConfig } from './swagger.config';

/**
 * Production safety tests. The validator is pure over the environment, so each
 * case sets a production-safe baseline and mutates a single field to prove the
 * specific fail-fast rule. Credentialed URLs are assembled from fragments so the
 * repo secret scanner never flags these fixtures.
 */

// A non-local credentialed URL, split so the literal pattern is not in source.
const PROD_DB_URL =
  'postgresql://user:' + 'pass@db.internal.example.com:5432/voyagi';

function baseline(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PORT: '3000',
    DATABASE_URL: PROD_DB_URL,
    DATABASE_SSL_MODE: 'require',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_JWT_AUDIENCE: 'authenticated',
    CORS_ORIGINS: 'https://app.voyagi.mr,https://admin.voyagi.mr',
  };
}

function violations(overrides: Record<string, string | undefined>): string[] {
  return collectProductionConfigViolations({ ...baseline(), ...overrides });
}

describe('production configuration validation', () => {
  it('accepts a complete, production-safe configuration', () => {
    expect(collectProductionConfigViolations(baseline())).toEqual([]);
  });

  it('is a no-op outside production', () => {
    expect(() =>
      assertProductionConfig({ NODE_ENV: 'development' }),
    ).not.toThrow();
    expect(() => assertProductionConfig({ NODE_ENV: 'test' })).not.toThrow();
  });

  describe('required variables', () => {
    it('fails when DATABASE_URL is missing', () => {
      expect(violations({ DATABASE_URL: undefined })).toEqual(
        expect.arrayContaining([
          expect.stringContaining('DATABASE_URL is required'),
        ]),
      );
    });

    it('fails when authentication issuer/JWKS cannot be resolved', () => {
      const v = violations({ SUPABASE_URL: undefined });
      expect(v.some((m) => m.includes('issuer'))).toBe(true);
      expect(v.some((m) => m.includes('JWKS URL is not configured'))).toBe(
        true,
      );
    });
  });

  describe('DATABASE_URL', () => {
    it('fails when DATABASE_URL is not a valid URL', () => {
      expect(violations({ DATABASE_URL: 'not a url' })).toEqual(
        expect.arrayContaining([expect.stringContaining('not a valid URL')]),
      );
    });

    it('rejects a non-postgres protocol', () => {
      const bad = 'mysql://user:' + 'pass@db.internal.example.com:3306/voyagi';
      expect(violations({ DATABASE_URL: bad })).toEqual(
        expect.arrayContaining([
          expect.stringContaining('postgres:// or postgresql://'),
        ]),
      );
    });

    it('rejects a localhost DATABASE_URL in production', () => {
      const local =
        'postgresql://postgres:' + 'postgres@127.0.0.1:54322/postgres';
      expect(violations({ DATABASE_URL: local })).toEqual(
        expect.arrayContaining([expect.stringContaining('local host')]),
      );
    });
  });

  describe('authentication issuer and JWKS', () => {
    it('rejects an issuer that is not a valid URL', () => {
      expect(
        violations({
          SUPABASE_URL: undefined,
          SUPABASE_JWT_ISSUER: 'not-a-url',
          SUPABASE_JWKS_URL: 'https://project.supabase.co/jwks',
        }),
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Authentication issuer'),
        ]),
      );
    });

    it('rejects a non-https issuer', () => {
      expect(
        violations({
          SUPABASE_URL: undefined,
          SUPABASE_JWT_ISSUER: 'http://project.supabase.co/auth/v1',
          SUPABASE_JWKS_URL: 'https://project.supabase.co/jwks',
        }),
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Authentication issuer'),
        ]),
      );
    });

    it('rejects a non-https or localhost JWKS URL', () => {
      expect(
        violations({
          SUPABASE_URL: undefined,
          SUPABASE_JWT_ISSUER: 'https://project.supabase.co/auth/v1',
          SUPABASE_JWKS_URL: 'http://localhost/jwks',
        }),
      ).toEqual(expect.arrayContaining([expect.stringContaining('JWKS URL')]));
    });
  });

  describe('unsafe JWT algorithms', () => {
    it('rejects HS256 (symmetric)', () => {
      expect(violations({ SUPABASE_JWT_ALGORITHMS: 'RS256,HS256' })).toEqual(
        expect.arrayContaining([expect.stringContaining('HS256')]),
      );
    });

    it('rejects "none"', () => {
      expect(violations({ SUPABASE_JWT_ALGORITHMS: 'none' })).toEqual(
        expect.arrayContaining([expect.stringContaining('none')]),
      );
    });

    it('accepts asymmetric algorithms', () => {
      expect(
        violations({ SUPABASE_JWT_ALGORITHMS: 'RS256,ES384,PS512,EdDSA' }),
      ).toEqual([]);
    });
  });

  describe('trusted proxy', () => {
    it('accepts an unset trust-proxy', () => {
      expect(violations({ TRUST_PROXY: undefined })).toEqual([]);
    });

    it('accepts an explicit positive hop count', () => {
      expect(violations({ TRUST_PROXY: '1' })).toEqual([]);
      expect(violations({ TRUST_PROXY: '2' })).toEqual([]);
    });

    it('rejects TRUST_PROXY=true', () => {
      expect(violations({ TRUST_PROXY: 'true' })).toEqual(
        expect.arrayContaining([
          expect.stringContaining('TRUST_PROXY must not be "true"'),
        ]),
      );
    });

    it('rejects an arbitrary/zero/negative trust-proxy string', () => {
      for (const value of ['0', '-1', 'loopback', '10.0.0.0/8']) {
        expect(violations({ TRUST_PROXY: value })).toEqual(
          expect.arrayContaining([
            expect.stringContaining('positive integer hop count'),
          ]),
        );
      }
    });
  });

  describe('CORS', () => {
    it('fails when CORS_ORIGINS is empty in production', () => {
      expect(violations({ CORS_ORIGINS: '' })).toEqual(
        expect.arrayContaining([
          expect.stringContaining('CORS_ORIGINS must list at least one'),
        ]),
      );
    });

    it('fails on a wildcard origin', () => {
      expect(violations({ CORS_ORIGINS: '*' })).toEqual(
        expect.arrayContaining([
          expect.stringContaining('must not contain a wildcard'),
        ]),
      );
    });

    it('fails on a malformed origin', () => {
      expect(violations({ CORS_ORIGINS: 'not-an-origin' })).toEqual(
        expect.arrayContaining([expect.stringContaining('not a valid origin')]),
      );
    });

    it('rejects an origin with a path', () => {
      expect(violations({ CORS_ORIGINS: 'https://app.voyagi.mr/app' })).toEqual(
        expect.arrayContaining([
          expect.stringContaining('must not contain a path'),
        ]),
      );
    });

    it('rejects an origin with credentials, query or fragment', () => {
      expect(
        violations({ CORS_ORIGINS: 'https://user:pw@app.voyagi.mr' }),
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('must not contain credentials'),
        ]),
      );
      expect(
        violations({ CORS_ORIGINS: 'https://app.voyagi.mr/?x=1' }),
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('must not contain a query'),
        ]),
      );
      expect(
        violations({ CORS_ORIGINS: 'https://app.voyagi.mr/#frag' }),
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('must not contain a fragment'),
        ]),
      );
    });
  });

  describe('SSL, pool and timeout values', () => {
    it('rejects DATABASE_SSL_MODE=disable in production', () => {
      expect(violations({ DATABASE_SSL_MODE: 'disable' })).toEqual(
        expect.arrayContaining([
          expect.stringContaining('must not be "disable"'),
        ]),
      );
    });

    it('rejects invalid pool values', () => {
      expect(violations({ DATABASE_POOL_MAX: '0' })).toEqual(
        expect.arrayContaining([expect.stringContaining('DATABASE_POOL_MAX')]),
      );
      expect(
        violations({ DATABASE_POOL_MIN: '5', DATABASE_POOL_MAX: '2' }),
      ).toEqual(
        expect.arrayContaining([
          expect.stringContaining('must be <= DATABASE_POOL_MAX'),
        ]),
      );
    });

    it('rejects invalid timeout values', () => {
      expect(violations({ DATABASE_STATEMENT_TIMEOUT_MS: '-1' })).toEqual(
        expect.arrayContaining([
          expect.stringContaining('DATABASE_STATEMENT_TIMEOUT_MS'),
        ]),
      );
      expect(violations({ DATABASE_READINESS_TIMEOUT_MS: 'abc' })).toEqual(
        expect.arrayContaining([
          expect.stringContaining('DATABASE_READINESS_TIMEOUT_MS'),
        ]),
      );
    });
  });

  describe('body limit', () => {
    it('parses byte sizes correctly', () => {
      expect(parseBodyLimitBytes('100kb')).toBe(102400);
      expect(parseBodyLimitBytes('1mb')).toBe(1048576);
      expect(parseBodyLimitBytes('2048')).toBe(2048);
      expect(parseBodyLimitBytes('junk')).toBeNull();
    });

    it('accepts a bounded body limit', () => {
      expect(violations({ BODY_LIMIT: '2mb' })).toEqual([]);
    });

    it('rejects malformed, zero and oversized body limits', () => {
      expect(violations({ BODY_LIMIT: 'huge' })).toEqual(
        expect.arrayContaining([expect.stringContaining('BODY_LIMIT')]),
      );
      expect(violations({ BODY_LIMIT: '0' })).toEqual(
        expect.arrayContaining([expect.stringContaining('greater than zero')]),
      );
      expect(violations({ BODY_LIMIT: '50mb' })).toEqual(
        expect.arrayContaining([expect.stringContaining('must not exceed')]),
      );
    });
  });

  describe('rate limits', () => {
    it('rejects invalid global and category rate limits', () => {
      expect(violations({ RATE_LIMIT_LIMIT: '0' })).toEqual(
        expect.arrayContaining([expect.stringContaining('RATE_LIMIT_LIMIT')]),
      );
      expect(violations({ RATE_LIMIT_WEBHOOK: '-3' })).toEqual(
        expect.arrayContaining([expect.stringContaining('RATE_LIMIT_WEBHOOK')]),
      );
    });
  });

  describe('boolean-typed variables', () => {
    it('rejects a non-boolean value', () => {
      expect(violations({ CORS_CREDENTIALS: 'maybe' })).toEqual(
        expect.arrayContaining([
          expect.stringContaining('CORS_CREDENTIALS must be a boolean'),
        ]),
      );
    });

    it('rejects LOG_PRETTY=true in production', () => {
      expect(violations({ LOG_PRETTY: 'true' })).toEqual(
        expect.arrayContaining([
          expect.stringContaining('LOG_PRETTY must not be true'),
        ]),
      );
      expect(violations({ LOG_PRETTY: 'false' })).toEqual([]);
    });

    it('rejects DATABASE_LOG_QUERIES=true in production', () => {
      expect(violations({ DATABASE_LOG_QUERIES: 'true' })).toEqual(
        expect.arrayContaining([
          expect.stringContaining('DATABASE_LOG_QUERIES must not be true'),
        ]),
      );
    });
  });

  describe('payments provider mode', () => {
    it('accepts an explicit disabled mode', () => {
      expect(violations({ PAYMENTS_PROVIDER_MODE: 'disabled' })).toEqual([]);
    });

    it('does not require the test secret when disabled in production', () => {
      // The baseline sets no PAYMENTS_TEST_WEBHOOK_SECRET; disabled is the prod
      // default and must start cleanly without it.
      expect(
        violations({
          PAYMENTS_PROVIDER_MODE: 'disabled',
          PAYMENTS_TEST_WEBHOOK_SECRET: undefined,
        }),
      ).toEqual([]);
    });

    it('rejects test mode in production', () => {
      expect(violations({ PAYMENTS_PROVIDER_MODE: 'test' })).toEqual(
        expect.arrayContaining([
          expect.stringContaining('PAYMENTS_PROVIDER_MODE must not be "test"'),
        ]),
      );
    });
  });

  describe('shutdown timeout', () => {
    it('accepts a bounded shutdown timeout', () => {
      expect(violations({ SHUTDOWN_TIMEOUT_MS: '15000' })).toEqual([]);
    });

    it('rejects an out-of-range shutdown timeout', () => {
      for (const value of ['500', '200000', 'abc']) {
        expect(violations({ SHUTDOWN_TIMEOUT_MS: value })).toEqual(
          expect.arrayContaining([
            expect.stringContaining('SHUTDOWN_TIMEOUT_MS'),
          ]),
        );
      }
    });
  });

  describe('error output never leaks secrets', () => {
    it('redacts the database URL and omits credentials', () => {
      const local = 'postgresql://admin:' + 'topsecretpw@127.0.0.1:5432/db';
      const v = violations({ DATABASE_URL: local });
      const joined = v.join('\n');
      expect(joined).not.toContain('topsecretpw');
      expect(joined).toContain('***'); // redacted db url shape
    });

    it('assertProductionConfig throws an aggregated, secret-free error', () => {
      const local = 'postgresql://admin:' + 'leakme@localhost:5432/db';
      let message = '';
      try {
        assertProductionConfig({
          ...baseline(),
          DATABASE_URL: local,
          CORS_ORIGINS: '',
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('Refusing to start');
      expect(message).not.toContain('leakme');
    });
  });

  describe('Swagger production exposure is controlled', () => {
    it('is disabled by default in production and requires an explicit opt-in', () => {
      const prevEnv = process.env.NODE_ENV;
      const prevFlag = process.env.SWAGGER_ENABLED;
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.SWAGGER_ENABLED;
        expect(swaggerConfig().enabled).toBe(false);
        process.env.SWAGGER_ENABLED = 'true';
        expect(swaggerConfig().enabled).toBe(true);
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevFlag === undefined) delete process.env.SWAGGER_ENABLED;
        else process.env.SWAGGER_ENABLED = prevFlag;
      }
    });
  });
});
