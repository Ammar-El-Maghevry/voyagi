import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  READINESS_INDICATORS,
  ReadinessIndicator,
} from './readiness-indicator';

/** Liveness payload: the process is up and able to handle requests. */
export interface LivenessStatus {
  status: 'ok';
}

/** Readiness payload: aggregated dependency check results. */
export interface ReadinessStatus {
  status: 'ok';
  checks: Record<string, 'up'>;
}

/**
 * Computes liveness and readiness. Readiness aggregates all registered
 * {@link ReadinessIndicator}s; in Phase 1 none are registered yet, so the app
 * is ready as soon as it is live. The seam lets later phases plug in a database
 * indicator without changing controllers.
 */
@Injectable()
export class HealthService {
  constructor(
    @Inject(READINESS_INDICATORS)
    private readonly indicators: ReadinessIndicator[],
  ) {}

  checkLiveness(): LivenessStatus {
    return { status: 'ok' };
  }

  async checkReadiness(): Promise<ReadinessStatus> {
    const checks: Record<string, 'up'> = {};
    const failures: string[] = [];

    const results = await Promise.all(
      this.indicators.map(async (indicator) => ({
        name: indicator.name,
        result: await indicator.check(),
      })),
    );

    for (const { name, result } of results) {
      if (result.status === 'up') {
        checks[name] = 'up';
      } else {
        failures.push(result.detail ? `${name}: ${result.detail}` : name);
      }
    }

    if (failures.length > 0) {
      throw new ServiceUnavailableException(
        `Service dependencies are not ready: ${failures.join(', ')}`,
      );
    }

    return { status: 'ok', checks };
  }
}
