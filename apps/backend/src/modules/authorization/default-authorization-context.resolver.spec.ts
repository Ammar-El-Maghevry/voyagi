import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import type { AuthorizationResolutionRequest } from './authorization-context-resolver';
import { DefaultAuthorizationContextResolver } from './default-authorization-context.resolver';

describe('DefaultAuthorizationContextResolver', () => {
  const resolver = new DefaultAuthorizationContextResolver();

  const requestFor = (
    principal: AuthenticatedPrincipal,
    companyId?: string,
  ): AuthorizationResolutionRequest => ({
    principal,
    companyId,
    requestId: 'req-1',
  });

  it('resolves a context carrying the verified user id', async () => {
    const principal = { userId: 'user-1' } as AuthenticatedPrincipal;
    const context = await resolver.resolve(requestFor(principal));

    expect(context.userId).toBe('user-1');
  });

  it('grants no permissions (secure by default)', async () => {
    const principal = { userId: 'user-1' } as AuthenticatedPrincipal;
    const context = await resolver.resolve(requestFor(principal));

    expect(context.permissions).toEqual([]);
  });

  it('does not infer role, membership, or permissions from token metadata', async () => {
    const principal = {
      userId: 'user-1',
      role: 'authenticated',
      email: 'user@example.com',
    } as AuthenticatedPrincipal;

    const context = await resolver.resolve(requestFor(principal, 'company-9'));

    // Nothing beyond the verified identity is fabricated.
    expect(context.role).toBeUndefined();
    expect(context.membershipId).toBeUndefined();
    expect(context.companyId).toBeUndefined();
    expect(context.permissions).toEqual([]);
  });

  it('is deterministic for the same principal', async () => {
    const principal = { userId: 'user-1' } as AuthenticatedPrincipal;
    const a = await resolver.resolve(requestFor(principal));
    const b = await resolver.resolve(requestFor(principal));

    expect(a).toEqual(b);
  });
});
