import { Module } from '@nestjs/common';
import { BusesController } from './buses.controller';
import { BUSES_REPOSITORY } from './buses.repository';
import { BusesService } from './buses.service';
import { PostgresBusesRepository } from './postgres-buses.repository';

/**
 * Buses (fleet) module (Phase 7).
 *
 * Owns company bus listing/read/create/update and activation transitions. Buses
 * are company-scoped (no branch dimension), so it needs no entitlement
 * resolution — the guard's company permission (`fleet.read`/`fleet.manage`)
 * plus `company_id` SQL scoping are the full boundary. The database connection
 * comes from the global `DatabaseModule`.
 */
@Module({
  controllers: [BusesController],
  providers: [
    { provide: BUSES_REPOSITORY, useClass: PostgresBusesRepository },
    BusesService,
  ],
})
export class BusesModule {}
