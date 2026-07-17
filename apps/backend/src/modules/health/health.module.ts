import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { READINESS_INDICATORS } from './readiness-indicator';

/**
 * Health module. Provides an empty default set of readiness indicators; later
 * phases extend it (e.g. a database indicator) without touching this module's
 * public surface.
 */
@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    { provide: READINESS_INDICATORS, useValue: [] },
  ],
})
export class HealthModule {}
