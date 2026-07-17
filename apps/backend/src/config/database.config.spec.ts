import { databaseConfig, LOCAL_DATABASE_URL } from './database.config';
import { validateEnvironment } from './env.validation';

/** Run a config factory with a scoped process.env, then restore it. */
function withEnv<T>(env: Record<string, string | undefined>, run: () => T): T {
  const original = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      // Assigning `undefined` would coerce to the string "undefined"; remove it.
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

describe('databaseConfig', () => {
  it('defaults to the local Supabase URL outside production', () => {
    const config = withEnv(
      { NODE_ENV: 'development', DATABASE_URL: undefined },
      () => databaseConfig(),
    );
    expect(config.url).toBe(LOCAL_DATABASE_URL);
    expect(config.sslMode).toBe('disable');
  });

  it('does not invent a URL in production (must be explicit)', () => {
    const config = withEnv(
      { NODE_ENV: 'production', DATABASE_URL: undefined },
      () => databaseConfig(),
    );
    expect(config.url).toBe('');
    expect(config.sslMode).toBe('require');
  });

  it('honors explicit connection and pool settings', () => {
    const config = withEnv(
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db:5432/app',
        DATABASE_POOL_MAX: '25',
        DATABASE_STATEMENT_TIMEOUT_MS: '15000',
        DATABASE_SSL_MODE: 'verify-full',
      },
      () => databaseConfig(),
    );
    expect(config.url).toBe('postgresql://user:pass@db:5432/app');
    expect(config.poolMax).toBe(25);
    expect(config.statementTimeoutMs).toBe(15000);
    expect(config.sslMode).toBe('verify-full');
  });
});

describe('environment validation for database variables', () => {
  it('accepts valid database configuration', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_POOL_MAX: '20',
        DATABASE_SSL_MODE: 'require',
      }),
    ).not.toThrow();
  });

  it('rejects an unsupported SSL mode', () => {
    expect(() =>
      validateEnvironment({ DATABASE_SSL_MODE: 'insecure' }),
    ).toThrow(/DATABASE_SSL_MODE/);
  });

  it('rejects a non-numeric pool size', () => {
    expect(() =>
      validateEnvironment({ DATABASE_POOL_MAX: 'lots' }),
    ).toThrow(/DATABASE_POOL_MAX/);
  });
});
