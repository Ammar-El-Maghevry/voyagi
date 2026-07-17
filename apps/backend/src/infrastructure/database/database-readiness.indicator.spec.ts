import type { ConfigService } from '@nestjs/config';
import { DatabaseReadinessIndicator } from './database-readiness.indicator';
import type { DatabaseService } from './database.service';

function configWithTimeout(ms: number): ConfigService {
  return { get: () => ({ readinessTimeoutMs: ms }) } as unknown as ConfigService;
}

function databaseWithQuery(query: jest.Mock): DatabaseService {
  return { query } as unknown as DatabaseService;
}

describe('DatabaseReadinessIndicator', () => {
  it('reports up when the readiness query succeeds', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const indicator = new DatabaseReadinessIndicator(
      databaseWithQuery(query),
      configWithTimeout(2000),
    );

    await expect(indicator.check()).resolves.toEqual({ status: 'up' });
    expect(query).toHaveBeenCalledWith('SELECT 1', [], {
      name: 'health.readiness',
    });
  });

  it('reports down (no internal details) when the query fails', async () => {
    const query = jest
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    const indicator = new DatabaseReadinessIndicator(
      databaseWithQuery(query),
      configWithTimeout(2000),
    );

    const result = await indicator.check();
    expect(result.status).toBe('down');
    expect(result.detail).toBe('Database is not reachable.');
    // Never leak host/port/driver internals.
    expect(JSON.stringify(result)).not.toContain('10.0.0.5');
  });

  it('reports down when the query exceeds the bounded timeout', async () => {
    // A query that never resolves must not hang the probe.
    const query = jest.fn().mockReturnValue(new Promise(() => undefined));
    const indicator = new DatabaseReadinessIndicator(
      databaseWithQuery(query),
      configWithTimeout(20),
    );

    const result = await indicator.check();
    expect(result.status).toBe('down');
  });
});
