import { Module } from '@nestjs/common';
import { DatabaseAuthorizationContextResolver } from './database-authorization-context.resolver';
import { IDENTITY_REPOSITORY } from './identity.repository';
import { IdentityService } from './identity.service';
import { MembershipsController } from './memberships.controller';
import { PostgresIdentityRepository } from './postgres-identity.repository';
import { ProfilesController } from './profiles.controller';

/**
 * Identity (users) module.
 *
 * Owns backend profiles and company-membership resolution: the self-service
 * profile endpoints, the company membership listing/read endpoints, and the
 * database-backed {@link DatabaseAuthorizationContextResolver}.
 *
 * It provides and exports the resolver so the app module can bind it to
 * `AUTHORIZATION_CONTEXT_RESOLVER`, replacing the Phase 4 default. The database
 * connection comes from the global `DatabaseModule`; no other module's tables
 * are touched.
 */
@Module({
  controllers: [ProfilesController, MembershipsController],
  providers: [
    { provide: IDENTITY_REPOSITORY, useClass: PostgresIdentityRepository },
    IdentityService,
    DatabaseAuthorizationContextResolver,
  ],
  exports: [DatabaseAuthorizationContextResolver, IdentityService],
})
export class IdentityModule {}
