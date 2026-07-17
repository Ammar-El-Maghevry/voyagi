import type { ConfigService } from '@nestjs/config';
import type { Pool, PoolClient } from 'pg';
import type { DatabaseConfig } from '../../config';
import { DatabaseErrorMapper } from './database-error.mapper';
import { DatabaseService } from './database.service';
import { UniqueConstraintViolationError } from './database.errors';

function fakeConfig(overrides: Partial<DatabaseConfig> = {}): ConfigService {
  const db: Partial<DatabaseConfig> = {
    logQueries: false,
    slowQueryMs: 500,
    ...overrides,
  };
  return { get: () => db } as unknown as ConfigService;
}

describe('DatabaseService', () => {
  it('runs a parameterized query and returns the driver result', async () => {
    const result = { rows: [{ n: 1 }], rowCount: 1 };
    const pool = { query: jest.fn().mockResolvedValue(result) };
    const service = new DatabaseService(
      pool as unknown as Pool,
      new DatabaseErrorMapper(),
      fakeConfig(),
    );

    const returned = await service.query('SELECT $1::int AS n', [1]);

    expect(pool.query).toHaveBeenCalledWith('SELECT $1::int AS n', [1]);
    expect(returned).toBe(result);
  });

  it('translates driver errors into typed application errors', async () => {
    const pool = {
      query: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' })),
    };
    const service = new DatabaseService(
      pool as unknown as Pool,
      new DatabaseErrorMapper(),
      fakeConfig(),
    );

    await expect(service.query('INSERT ...')).rejects.toBeInstanceOf(
      UniqueConstraintViolationError,
    );
  });

  it('always releases a borrowed client, even on failure', async () => {
    const client = { release: jest.fn() } as unknown as PoolClient;
    const pool = { connect: jest.fn().mockResolvedValue(client) };
    const service = new DatabaseService(
      pool as unknown as Pool,
      new DatabaseErrorMapper(),
      fakeConfig(),
    );

    await expect(
      service.withClient(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('reports pool statistics', () => {
    const pool = { totalCount: 5, idleCount: 3, waitingCount: 1 };
    const service = new DatabaseService(
      pool as unknown as Pool,
      new DatabaseErrorMapper(),
      fakeConfig(),
    );
    expect(service.getPoolStats()).toEqual({ total: 5, idle: 3, waiting: 1 });
  });

  it('closes the pool once on shutdown (idempotent)', async () => {
    const pool = { end: jest.fn().mockResolvedValue(undefined) };
    const service = new DatabaseService(
      pool as unknown as Pool,
      new DatabaseErrorMapper(),
      fakeConfig(),
    );

    await service.onApplicationShutdown();
    await service.onApplicationShutdown();

    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
