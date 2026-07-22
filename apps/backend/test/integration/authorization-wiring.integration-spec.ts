import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { AUTHORIZATION_CONTEXT_RESOLVER } from '../../src/modules/authorization/authorization-context-resolver';
import { DefaultAuthorizationContextResolver } from '../../src/modules/authorization/default-authorization-context.resolver';
import { DatabaseAuthorizationContextResolver } from '../../src/modules/identity/database-authorization-context.resolver';

/**
 * Provider-wiring proof (Phase 5, point 5).
 *
 * The authorization module ships a permission-less
 * {@link DefaultAuthorizationContextResolver} bound to
 * `AUTHORIZATION_CONTEXT_RESOLVER`. Phase 5 must replace that binding — purely
 * through DI — with the database-backed resolver, in the exact injector the
 * global authorization guard is constructed in (the AppModule injector). This
 * test compiles the real AppModule and asserts the effective binding, so a
 * regression that drops the override (falling back to the default that grants
 * no permissions) fails loudly here rather than silently 403-ing every
 * company-scoped route.
 *
 * It needs no database: it only compiles the module graph and inspects the
 * resolved provider, so it is deterministic and leaves no residue.
 */
describe('Authorization resolver wiring (integration)', () => {
  beforeAll(() => {
    // Non-production config defaults the database/JWKS URLs to the local stack;
    // no service is contacted because we only compile and inspect the graph.
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
  });

  it('binds AUTHORIZATION_CONTEXT_RESOLVER to the database-backed resolver', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const resolver = moduleRef
      .select(AppModule)
      .get(AUTHORIZATION_CONTEXT_RESOLVER, { strict: true });

    expect(resolver).toBeInstanceOf(DatabaseAuthorizationContextResolver);
    // And explicitly NOT the Phase 4 permission-less default.
    expect(resolver).not.toBeInstanceOf(DefaultAuthorizationContextResolver);

    await moduleRef.close();
  });
});
