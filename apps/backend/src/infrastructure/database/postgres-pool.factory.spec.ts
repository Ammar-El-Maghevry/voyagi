import type { ConfigService } from '@nestjs/config';
import type { DatabaseConfig } from '../../config';

const poolInstances: Array<{ config: unknown; on: jest.Mock }> = [];
const poolConstructor = jest.fn().mockImplementation((config: unknown) => {
  const instance = { config, on: jest.fn() };
  poolInstances.push(instance);
  return instance;
});

jest.mock('pg', () => ({
  Pool: poolConstructor,
}));

// Imported after the mock is registered.
import { createDatabasePool } from './postgres-pool.factory';

function configServiceReturning(db: Partial<DatabaseConfig>): ConfigService {
  return {
    getOrThrow: () => db,
  } as unknown as ConfigService;
}

const baseConfig: DatabaseConfig = {
  url: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  applicationName: 'voyagi-api',
  poolMin: 1,
  poolMax: 12,
  connectionTimeoutMs: 10000,
  idleTimeoutMs: 30000,
  statementTimeoutMs: 30000,
  sslMode: 'disable',
  readinessTimeoutMs: 2000,
  logQueries: false,
  slowQueryMs: 500,
};

describe('createDatabasePool', () => {
  beforeEach(() => {
    poolInstances.length = 0;
    poolConstructor.mockClear();
  });

  it('creates a pool with the mapped configuration and no SSL when disabled', () => {
    createDatabasePool(configServiceReturning(baseConfig));

    expect(poolConstructor).toHaveBeenCalledTimes(1);
    const passed = poolConstructor.mock.calls[0][0];
    expect(passed).toMatchObject({
      connectionString: baseConfig.url,
      application_name: 'voyagi-api',
      min: 1,
      max: 12,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      statement_timeout: 30000,
      ssl: false,
      allowExitOnIdle: false,
    });
  });

  it('enables certificate verification for verify-full', () => {
    createDatabasePool(
      configServiceReturning({ ...baseConfig, sslMode: 'verify-full' }),
    );
    expect(poolConstructor.mock.calls[0][0].ssl).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('encrypts without verification for require', () => {
    createDatabasePool(
      configServiceReturning({ ...baseConfig, sslMode: 'require' }),
    );
    expect(poolConstructor.mock.calls[0][0].ssl).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('registers an error handler so idle-client errors cannot crash the process', () => {
    createDatabasePool(configServiceReturning(baseConfig));
    expect(poolInstances[0].on).toHaveBeenCalledWith(
      'error',
      expect.any(Function),
    );
  });

  it('fails fast when the connection string is missing', () => {
    expect(() =>
      createDatabasePool(configServiceReturning({ ...baseConfig, url: '' })),
    ).toThrow(/DATABASE_URL is required/);
    expect(poolConstructor).not.toHaveBeenCalled();
  });
});
