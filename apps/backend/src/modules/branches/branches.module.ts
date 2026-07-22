import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { BranchesController } from './branches.controller';
import { BRANCHES_REPOSITORY } from './branches.repository';
import { BranchesService } from './branches.service';
import { PostgresBranchesRepository } from './postgres-branches.repository';

/**
 * Branches module (Phase 6).
 *
 * Owns company branch listing/read/create/update and activation transitions.
 * Reads are branch-scoped via the caller's per-membership entitlements, so it
 * imports {@link IdentityModule} to reuse `IdentityService` (the single source
 * of membership/entitlement truth) rather than re-deriving tenant logic. The
 * database connection comes from the global `DatabaseModule`.
 */
@Module({
  imports: [IdentityModule],
  controllers: [BranchesController],
  providers: [
    { provide: BRANCHES_REPOSITORY, useClass: PostgresBranchesRepository },
    BranchesService,
  ],
})
export class BranchesModule {}
