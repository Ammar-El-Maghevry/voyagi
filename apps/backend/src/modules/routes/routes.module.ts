import { Module } from '@nestjs/common';
import { StationsModule } from '../stations/stations.module';
import { PostgresRoutePricesRepository } from './postgres-route-prices.repository';
import { PostgresRoutesRepository } from './postgres-routes.repository';
import { ROUTE_PRICES_REPOSITORY } from './route-prices.repository';
import { RoutePricesController } from './route-prices.controller';
import { RoutePricesService } from './route-prices.service';
import { ROUTES_REPOSITORY } from './routes.repository';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';

/**
 * Routes module (Phase 8).
 *
 * Hosts two separate domain components that share a nested URL space: **routes**
 * (company-scoped CRUD + activation) and **route pricing** (append-only history).
 * They are kept as distinct services/repositories/controllers — the module only
 * co-locates them. Imports `StationsModule` to validate that a route's
 * origin/destination reference active global stations. The database connection
 * and `TransactionManager` come from the global `DatabaseModule`.
 *
 * The routes repository is exported so the trips module can validate that a
 * trip's route belongs to the same company and is active.
 */
@Module({
  imports: [StationsModule],
  controllers: [RoutesController, RoutePricesController],
  providers: [
    { provide: ROUTES_REPOSITORY, useClass: PostgresRoutesRepository },
    { provide: ROUTE_PRICES_REPOSITORY, useClass: PostgresRoutePricesRepository },
    RoutesService,
    RoutePricesService,
  ],
  exports: [ROUTES_REPOSITORY],
})
export class RoutesModule {}
