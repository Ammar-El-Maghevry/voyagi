import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DATABASE_POOL } from './database.constants';
import { DatabaseErrorMapper } from './database-error.mapper';
import { DatabaseReadinessIndicator } from './database-readiness.indicator';
import { DatabaseService } from './database.service';
import { createDatabasePool } from './postgres-pool.factory';
import { TransactionManager } from './transaction.manager';

/**
 * Reusable database infrastructure module.
 *
 * Global so later feature modules can inject {@link DatabaseService} and
 * {@link TransactionManager} without importing this module explicitly. It owns
 * the connection pool lifecycle and exposes only narrow abstractions — it
 * contains no domain repositories or business logic.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ConfigService],
      useFactory: createDatabasePool,
    },
    DatabaseErrorMapper,
    DatabaseService,
    TransactionManager,
    DatabaseReadinessIndicator,
  ],
  exports: [
    DATABASE_POOL,
    DatabaseErrorMapper,
    DatabaseService,
    TransactionManager,
    DatabaseReadinessIndicator,
  ],
})
export class DatabaseModule {}
