import { authConfig, DEFAULT_JWT_ALGORITHMS } from './auth.config';
import { validateEnvironment } from './env.validation';

function withEnv<T>(env: Record<string, string | undefined>, run: () => T): T {
  const original = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return run();
  } finally {
    process.env = original;
  }
}

describe('authConfig', () => {
  it('derives issuer and JWKS URL from SUPABASE_URL', () => {
    const config = withEnv(
      {
        NODE_ENV: 'development',
        SUPABASE_URL: 'https://proj.supabase.co/',
        SUPABASE_JWT_ISSUER: undefined,
        SUPABASE_JWKS_URL: undefined,
      },
      () => authConfig(),
    );
    expect(config.issuer).toBe('https://proj.supabase.co/auth/v1');
    expect(config.jwksUrl).toBe(
      'https://proj.supabase.co/auth/v1/.well-known/jwks.json',
    );
    expect(config.audience).toBe('authenticated');
    expect(config.algorithms).toEqual(DEFAULT_JWT_ALGORITHMS);
  });

  it('defaults to the local Supabase URL outside production', () => {
    const config = withEnv(
      { NODE_ENV: 'development', SUPABASE_URL: undefined },
      () => authConfig(),
    );
    expect(config.issuer).toBe('http://127.0.0.1:54321/auth/v1');
  });

  it('does not invent a URL in production (must be explicit)', () => {
    const config = withEnv(
      { NODE_ENV: 'production', SUPABASE_URL: undefined },
      () => authConfig(),
    );
    expect(config.supabaseUrl).toBe('');
    expect(config.issuer).toBe('');
    expect(config.jwksUrl).toBe('');
  });

  it('honors explicit overrides', () => {
    const config = withEnv(
      {
        SUPABASE_JWT_ISSUER: 'https://iss/auth/v1',
        SUPABASE_JWKS_URL: 'https://iss/jwks',
        SUPABASE_JWT_AUDIENCE: 'authenticated',
        SUPABASE_JWT_ALGORITHMS: 'RS256, ES384',
      },
      () => authConfig(),
    );
    expect(config.issuer).toBe('https://iss/auth/v1');
    expect(config.jwksUrl).toBe('https://iss/jwks');
    expect(config.algorithms).toEqual(['RS256', 'ES384']);
  });
});

describe('environment validation for auth variables', () => {
  it('accepts valid auth configuration', () => {
    expect(() =>
      validateEnvironment({
        SUPABASE_URL: 'https://proj.supabase.co',
        AUTH_JWKS_TIMEOUT_MS: '5000',
      }),
    ).not.toThrow();
  });

  it('rejects a non-numeric JWKS timeout', () => {
    expect(() =>
      validateEnvironment({ AUTH_JWKS_TIMEOUT_MS: 'soon' }),
    ).toThrow(/AUTH_JWKS_TIMEOUT_MS/);
  });
});
