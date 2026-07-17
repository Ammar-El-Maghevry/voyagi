import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';
import { ReadinessIndicator } from './readiness-indicator';

describe('HealthService', () => {
  it('reports liveness as ok', () => {
    const service = new HealthService([]);
    expect(service.checkLiveness()).toEqual({ status: 'ok' });
  });

  it('is ready with no registered indicators', async () => {
    const service = new HealthService([]);
    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ok',
      checks: {},
    });
  });

  it('aggregates healthy indicators into the checks map', async () => {
    const indicator: ReadinessIndicator = {
      name: 'database',
      check: async () => ({ status: 'up' }),
    };
    const service = new HealthService([indicator]);

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up' },
    });
  });

  it('fails readiness when an indicator is down', async () => {
    const indicator: ReadinessIndicator = {
      name: 'database',
      check: async () => ({ status: 'down', detail: 'connection refused' }),
    };
    const service = new HealthService([indicator]);

    await expect(service.checkReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
