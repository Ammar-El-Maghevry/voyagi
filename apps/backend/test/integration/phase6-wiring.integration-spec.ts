import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { AUTHORIZATION_CONTEXT_RESOLVER } from '../../src/modules/authorization/authorization-context-resolver';
import { DefaultAuthorizationContextResolver } from '../../src/modules/authorization/default-authorization-context.resolver';
import { BranchesController } from '../../src/modules/branches/branches.controller';
import { BranchesService } from '../../src/modules/branches/branches.service';
import { BRANCHES_REPOSITORY } from '../../src/modules/branches/branches.repository';
import { PostgresBranchesRepository } from '../../src/modules/branches/postgres-branches.repository';
import { DatabaseAuthorizationContextResolver } from '../../src/modules/identity/database-authorization-context.resolver';
import { StaffController } from '../../src/modules/staff/staff.controller';
import { StaffService } from '../../src/modules/staff/staff.service';
import { STAFF_REPOSITORY } from '../../src/modules/staff/staff.repository';
import { PostgresStaffRepository } from '../../src/modules/staff/postgres-staff.repository';

/**
 * Provider-wiring proof for Phase 6. Compiles the real AppModule and asserts the
 * branches and staff modules are loaded, controllers resolve their services,
 * repository ports resolve to the PostgreSQL adapters, and the Phase 5
 * database-backed authorization resolver is still the active binding (the Phase
 * 4 permission-less default was not accidentally restored). Needs no database —
 * it only inspects the module graph.
 */
describe('Phase 6 module wiring (integration)', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
  });

  it('wires branches, staff, and the database authorization resolver', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Controllers and their services resolve (feature-module providers, so a
    // non-strict lookup from the root injector).
    const opts = { strict: false } as const;
    expect(moduleRef.get(BranchesController, opts)).toBeInstanceOf(BranchesController);
    expect(moduleRef.get(StaffController, opts)).toBeInstanceOf(StaffController);
    expect(moduleRef.get(BranchesService, opts)).toBeInstanceOf(BranchesService);
    expect(moduleRef.get(StaffService, opts)).toBeInstanceOf(StaffService);

    // Repository ports resolve to the PostgreSQL implementations.
    expect(moduleRef.get(BRANCHES_REPOSITORY, opts)).toBeInstanceOf(PostgresBranchesRepository);
    expect(moduleRef.get(STAFF_REPOSITORY, opts)).toBeInstanceOf(PostgresStaffRepository);

    // The Phase 5 database resolver is still the effective binding.
    const resolver = moduleRef
      .select(AppModule)
      .get(AUTHORIZATION_CONTEXT_RESOLVER, { strict: true });
    expect(resolver).toBeInstanceOf(DatabaseAuthorizationContextResolver);
    expect(resolver).not.toBeInstanceOf(DefaultAuthorizationContextResolver);

    await moduleRef.close();
  });
});
