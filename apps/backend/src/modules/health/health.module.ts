import { Module } from '@nestjs/common';
import { DatabaseReadinessIndicator } from '../../infrastructure/database';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import {
  READINESS_INDICATORS,
  ReadinessIndicator,
} from './readiness-indicator';

/**
 * Health module. Aggregates the readiness indicators contributed by
 * infrastructure modules. The database indicator (provided globally by the
 * database module) is registered here so `GET /api/v1/health/ready` reflects
 * real database availability, while liveness stays dependency-independent.
 */
@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: READINESS_INDICATORS,
      inject: [DatabaseReadinessIndicator],
      useFactory: (
        database: DatabaseReadinessIndicator,
      ): ReadinessIndicator[] => [database],
    },
  ],
})
export class HealthModule {}
