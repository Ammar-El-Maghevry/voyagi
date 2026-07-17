import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DatabaseConfig } from '../../config';
import type {
  ReadinessIndicator,
  ReadinessResult,
} from '../../modules/health/readiness-indicator';
import { DatabaseService } from './database.service';

/**
 * Readiness probe for the database. Runs a minimal `SELECT 1` under a bounded
 * timeout and reports `up`/`down` without exposing any connection details.
 *
 * Plugged into the health module's readiness aggregation so
 * `GET /api/v1/health/ready` reflects real database availability. Liveness is
 * intentionally independent of this check.
 */
@Injectable()
export class DatabaseReadinessIndicator implements ReadinessIndicator {
  readonly name = 'database';

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<ReadinessResult> {
    const timeoutMs =
      this.config.get<DatabaseConfig>('database')?.readinessTimeoutMs ?? 2_000;

    try {
      await this.withTimeout(
        this.database.query('SELECT 1', [], { name: 'health.readiness' }),
        timeoutMs,
      );
      return { status: 'up' };
    } catch {
      // Deliberately generic: never leak host, driver, or error internals.
      return { status: 'down', detail: 'Database is not reachable.' };
    }
  }

  /** Reject after `ms` if `promise` has not settled, without leaking its late result. */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Database readiness check timed out')),
        ms,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error('failed'));
        },
      );
    });
  }
}
