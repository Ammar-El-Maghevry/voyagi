import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { AUTHORIZATION_CONTEXT_RESOLVER } from '../../src/modules/authorization/authorization-context-resolver';
import { DefaultAuthorizationContextResolver } from '../../src/modules/authorization/default-authorization-context.resolver';
import { DatabaseAuthorizationContextResolver } from '../../src/modules/identity/database-authorization-context.resolver';
import { RoutesController } from '../../src/modules/routes/routes.controller';
import { RoutesService } from '../../src/modules/routes/routes.service';
import { ROUTES_REPOSITORY } from '../../src/modules/routes/routes.repository';
import { PostgresRoutesRepository } from '../../src/modules/routes/postgres-routes.repository';
import { RoutePricesController } from '../../src/modules/routes/route-prices.controller';
import { RoutePricesService } from '../../src/modules/routes/route-prices.service';
import { ROUTE_PRICES_REPOSITORY } from '../../src/modules/routes/route-prices.repository';
import { PostgresRoutePricesRepository } from '../../src/modules/routes/postgres-route-prices.repository';
import { TripsController } from '../../src/modules/trips/trips.controller';
import { TripsService } from '../../src/modules/trips/trips.service';
import { TRIPS_REPOSITORY } from '../../src/modules/trips/trips.repository';
import { PostgresTripsRepository } from '../../src/modules/trips/postgres-trips.repository';
import { TripEventsController } from '../../src/modules/trips/trip-events.controller';
import { TRIP_EVENTS_REPOSITORY } from '../../src/modules/trips/trip-events.repository';
import { PostgresTripEventsRepository } from '../../src/modules/trips/postgres-trip-events.repository';
import { BusesController } from '../../src/modules/buses/buses.controller';

/**
 * Provider-wiring proof for the combined Phase 8 + 9. Compiles the real
 * AppModule and asserts the routes, pricing and trips components are loaded,
 * controllers resolve their services, repository ports resolve to the PostgreSQL
 * adapters, the Phase 5 database authorization resolver is still the active
 * binding (the Phase 4 default was not restored), and the Phase 7 modules remain
 * resolvable. Needs no database — it only inspects the module graph.
 */
describe('Phase 8 + 9 module wiring (integration)', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
  });

  it('wires routes, pricing and trips and preserves earlier phases', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const opts = { strict: false } as const;

    expect(moduleRef.get(RoutesController, opts)).toBeInstanceOf(RoutesController);
    expect(moduleRef.get(RoutePricesController, opts)).toBeInstanceOf(RoutePricesController);
    expect(moduleRef.get(TripsController, opts)).toBeInstanceOf(TripsController);
    expect(moduleRef.get(TripEventsController, opts)).toBeInstanceOf(TripEventsController);
    expect(moduleRef.get(RoutesService, opts)).toBeInstanceOf(RoutesService);
    expect(moduleRef.get(RoutePricesService, opts)).toBeInstanceOf(RoutePricesService);
    expect(moduleRef.get(TripsService, opts)).toBeInstanceOf(TripsService);

    expect(moduleRef.get(ROUTES_REPOSITORY, opts)).toBeInstanceOf(PostgresRoutesRepository);
    expect(moduleRef.get(ROUTE_PRICES_REPOSITORY, opts)).toBeInstanceOf(PostgresRoutePricesRepository);
    expect(moduleRef.get(TRIPS_REPOSITORY, opts)).toBeInstanceOf(PostgresTripsRepository);
    expect(moduleRef.get(TRIP_EVENTS_REPOSITORY, opts)).toBeInstanceOf(PostgresTripEventsRepository);

    // Phase 7 modules remain resolvable.
    expect(moduleRef.get(BusesController, opts)).toBeInstanceOf(BusesController);

    const resolver = moduleRef.select(AppModule).get(AUTHORIZATION_CONTEXT_RESOLVER, { strict: true });
    expect(resolver).toBeInstanceOf(DatabaseAuthorizationContextResolver);
    expect(resolver).not.toBeInstanceOf(DefaultAuthorizationContextResolver);

    await moduleRef.close();
  });
});
