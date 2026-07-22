import { Module } from '@nestjs/common';
import { PostgresStationsRepository } from './postgres-stations.repository';
import { StationsController } from './stations.controller';
import { STATIONS_REPOSITORY } from './stations.repository';
import { StationsService } from './stations.service';

/**
 * Stations module (Phase 7).
 *
 * Owns read-only access to the global, city-scoped station reference catalog.
 * Stations are not tenant-owned, so it needs no entitlement resolution —
 * authentication alone governs reads. The database connection comes from the
 * global `DatabaseModule`.
 */
@Module({
  controllers: [StationsController],
  providers: [
    { provide: STATIONS_REPOSITORY, useClass: PostgresStationsRepository },
    StationsService,
  ],
})
export class StationsModule {}
