import { Module } from '@nestjs/common';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { PostgresTripEventsRepository } from './postgres-trip-events.repository';
import { PostgresTripsRepository } from './postgres-trips.repository';
import { TRIP_EVENTS_REPOSITORY } from './trip-events.repository';
import { TripEventsController } from './trip-events.controller';
import { TripEventsService } from './trip-events.service';
import { TRIPS_REPOSITORY } from './trips.repository';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

/**
 * Trips module (Phase 9).
 *
 * Hosts two separate domain components sharing a nested URL space: **trips**
 * (company-scoped scheduling + lifecycle) and the append-only **trip events**
 * log. Trips are company-scoped (no branch dimension), so no entitlement
 * resolution is needed — the guard's company permission (`trips.read`/
 * `trips.manage`) plus `company_id` SQL scoping are the full boundary.
 *
 * The route/bus/settings validation reads at trip creation are scoped, in-
 * transaction reads owned by the trips adapter, so this module needs no compile-
 * time dependency on the routes or buses modules. The database connection and
 * `TransactionManager` come from the global `DatabaseModule`.
 */
@Module({
  imports: [MaintenanceModule],
  controllers: [TripsController, TripEventsController],
  providers: [
    { provide: TRIPS_REPOSITORY, useClass: PostgresTripsRepository },
    { provide: TRIP_EVENTS_REPOSITORY, useClass: PostgresTripEventsRepository },
    TripsService,
    TripEventsService,
  ],
})
export class TripsModule {}
