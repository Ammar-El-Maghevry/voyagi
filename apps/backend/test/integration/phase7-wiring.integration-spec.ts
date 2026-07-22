import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { AUTHORIZATION_CONTEXT_RESOLVER } from '../../src/modules/authorization/authorization-context-resolver';
import { DefaultAuthorizationContextResolver } from '../../src/modules/authorization/default-authorization-context.resolver';
import { BusesController } from '../../src/modules/buses/buses.controller';
import { BusesService } from '../../src/modules/buses/buses.service';
import { BUSES_REPOSITORY } from '../../src/modules/buses/buses.repository';
import { PostgresBusesRepository } from '../../src/modules/buses/postgres-buses.repository';
import { CitiesController } from '../../src/modules/cities/cities.controller';
import { CitiesService } from '../../src/modules/cities/cities.service';
import { CITIES_REPOSITORY } from '../../src/modules/cities/cities.repository';
import { PostgresCitiesRepository } from '../../src/modules/cities/postgres-cities.repository';
import { StationsController } from '../../src/modules/stations/stations.controller';
import { StationsService } from '../../src/modules/stations/stations.service';
import { STATIONS_REPOSITORY } from '../../src/modules/stations/stations.repository';
import { PostgresStationsRepository } from '../../src/modules/stations/postgres-stations.repository';
import { SeatLayoutsController } from '../../src/modules/seat-layouts/seat-layouts.controller';
import { SeatLayoutsService } from '../../src/modules/seat-layouts/seat-layouts.service';
import { SEAT_LAYOUTS_REPOSITORY } from '../../src/modules/seat-layouts/seat-layouts.repository';
import { PostgresSeatLayoutsRepository } from '../../src/modules/seat-layouts/postgres-seat-layouts.repository';
import { DatabaseAuthorizationContextResolver } from '../../src/modules/identity/database-authorization-context.resolver';
import { BranchesController } from '../../src/modules/branches/branches.controller';
import { StaffController } from '../../src/modules/staff/staff.controller';

/**
 * Provider-wiring proof for Phase 7. Compiles the real AppModule and asserts the
 * cities, stations, seat-layouts and buses modules are loaded, controllers
 * resolve their services, repository ports resolve to the PostgreSQL adapters,
 * the Phase 5 database-backed authorization resolver is still the active binding
 * (the Phase 4 permission-less default was not accidentally restored), and the
 * Phase 6 modules remain wired. Needs no database — it only inspects the module
 * graph.
 */
describe('Phase 7 module wiring (integration)', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
  });

  it('wires the catalog + fleet modules and preserves earlier phases', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const opts = { strict: false } as const;

    // Controllers and their services resolve (feature-module providers).
    expect(moduleRef.get(CitiesController, opts)).toBeInstanceOf(CitiesController);
    expect(moduleRef.get(StationsController, opts)).toBeInstanceOf(StationsController);
    expect(moduleRef.get(SeatLayoutsController, opts)).toBeInstanceOf(SeatLayoutsController);
    expect(moduleRef.get(BusesController, opts)).toBeInstanceOf(BusesController);
    expect(moduleRef.get(CitiesService, opts)).toBeInstanceOf(CitiesService);
    expect(moduleRef.get(StationsService, opts)).toBeInstanceOf(StationsService);
    expect(moduleRef.get(SeatLayoutsService, opts)).toBeInstanceOf(SeatLayoutsService);
    expect(moduleRef.get(BusesService, opts)).toBeInstanceOf(BusesService);

    // Repository ports resolve to the PostgreSQL implementations.
    expect(moduleRef.get(CITIES_REPOSITORY, opts)).toBeInstanceOf(PostgresCitiesRepository);
    expect(moduleRef.get(STATIONS_REPOSITORY, opts)).toBeInstanceOf(PostgresStationsRepository);
    expect(moduleRef.get(SEAT_LAYOUTS_REPOSITORY, opts)).toBeInstanceOf(PostgresSeatLayoutsRepository);
    expect(moduleRef.get(BUSES_REPOSITORY, opts)).toBeInstanceOf(PostgresBusesRepository);

    // Phase 6 modules remain functional.
    expect(moduleRef.get(BranchesController, opts)).toBeInstanceOf(BranchesController);
    expect(moduleRef.get(StaffController, opts)).toBeInstanceOf(StaffController);

    // The Phase 5 database resolver is still the effective binding.
    const resolver = moduleRef
      .select(AppModule)
      .get(AUTHORIZATION_CONTEXT_RESOLVER, { strict: true });
    expect(resolver).toBeInstanceOf(DatabaseAuthorizationContextResolver);
    expect(resolver).not.toBeInstanceOf(DefaultAuthorizationContextResolver);

    await moduleRef.close();
  });
});
