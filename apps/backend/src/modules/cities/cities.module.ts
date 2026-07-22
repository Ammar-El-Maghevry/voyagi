import { Module } from '@nestjs/common';
import { CitiesController } from './cities.controller';
import { CITIES_REPOSITORY } from './cities.repository';
import { CitiesService } from './cities.service';
import { PostgresCitiesRepository } from './postgres-cities.repository';

/**
 * Cities module (Phase 7).
 *
 * Owns read-only access to the global city reference catalog. Cities are not
 * tenant-owned, so it needs no entitlement resolution — authentication alone
 * governs reads. The database connection comes from the global
 * `DatabaseModule`.
 */
@Module({
  controllers: [CitiesController],
  providers: [
    { provide: CITIES_REPOSITORY, useClass: PostgresCitiesRepository },
    CitiesService,
  ],
})
export class CitiesModule {}
