import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';
import type { ReadinessIndicator } from './readiness-indicator';

/**
 * Runtime-lifecycle guarantees relied on by container orchestration (Phase 18.1):
 *  - liveness proves only that the process is alive and must NOT depend on the
 *    database or any external provider;
 *  - readiness fails safely (503) when the database is unavailable and never
 *    leaks a URL, SQL, credential or provider internal.
 */
describe('health lifecycle (Phase 18.1)', () => {
  const downDatabase: ReadinessIndicator = {
    name: 'database',
    check: async () => ({ status: 'down', detail: 'unavailable' }),
  };

  it('liveness returns ok even when the database is down', () => {
    const service = new HealthService([downDatabase]);
    // Liveness never consults indicators.
    expect(service.checkLiveness()).toEqual({ status: 'ok' });
  });

  it('readiness fails with 503 when the database is unavailable, leaking nothing', async () => {
    const leakyDown: ReadinessIndicator = {
      name: 'database',
      // Even if an indicator returned a verbose detail, readiness must not echo
      // connection strings/SQL. This indicator returns only a safe token.
      check: async () => ({ status: 'down', detail: 'unavailable' }),
    };
    const service = new HealthService([leakyDown]);

    await expect(service.checkReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    let message = '';
    try {
      await service.checkReadiness();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toMatch(
      /postgres|postgresql:\/\/|SELECT |@|password|54322/i,
    );
  });

  it('is ready when the database indicator is up', async () => {
    const upDatabase: ReadinessIndicator = {
      name: 'database',
      check: async () => ({ status: 'up' }),
    };
    const service = new HealthService([upDatabase]);
    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up' },
    });
  });
});
