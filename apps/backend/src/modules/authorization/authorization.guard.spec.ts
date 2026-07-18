import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrincipalUnavailableError } from '../auth/auth.errors';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import type { AuthorizationContext } from './authorization-context';
import type {
  AuthorizationContextResolver,
  AuthorizationResolutionRequest,
} from './authorization-context-resolver';
import { ForbiddenError } from './authorization.errors';
import { AuthorizationGuard } from './authorization.guard';
import { Permission } from './permission.enum';
import { PolicyEvaluator } from './policies/policy-evaluator';
import { RequirePermissions } from './decorators/require-permissions.decorator';

const principal = { userId: 'user-1' } as AuthenticatedPrincipal;

class ReadController {
  @RequirePermissions(Permission.CompaniesRead)
  read(): void {}

  open(): void {}
}

@RequirePermissions(Permission.CompaniesRead)
class ScopedController {
  @RequirePermissions(Permission.CompaniesUpdate)
  update(): void {}
}

function resolverReturning(
  context: AuthorizationContext | null,
  spy?: (input: AuthorizationResolutionRequest) => void,
): AuthorizationContextResolver {
  return {
    resolve: async (input) => {
      spy?.(input);
      return context;
    },
  };
}

function makeContext(
  handler: (...args: unknown[]) => unknown,
  cls: object,
  request: Partial<Request>,
  type = 'http',
): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function contextGranting(permissions: string[]): AuthorizationContext {
  return {
    userId: 'user-1',
    profileId: 'profile-1',
    companyId: 'company-1',
    membershipId: 'membership-1',
    role: 'manager',
    permissions,
  };
}

describe('AuthorizationGuard', () => {
  const reflector = new Reflector();
  const evaluator = new PolicyEvaluator();

  function guardWith(resolver: AuthorizationContextResolver): AuthorizationGuard {
    return new AuthorizationGuard(reflector, evaluator, resolver);
  }

  it('passes through non-http execution contexts', async () => {
    const guard = guardWith(resolverReturning(null));
    const context = makeContext(
      ReadController.prototype.read,
      ReadController,
      {},
      'rpc',
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows routes with no permission requirement without touching the resolver', async () => {
    const resolve = jest.fn();
    const guard = guardWith({ resolve });
    const context = makeContext(
      ReadController.prototype.open,
      ReadController,
      { principal },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('throws when a required-permission route has no principal (wiring error)', async () => {
    const guard = guardWith(resolverReturning(contextGranting([])));
    const context = makeContext(ReadController.prototype.read, ReadController, {});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      PrincipalUnavailableError,
    );
  });

  it('denies with 403 when the resolver cannot establish a context', async () => {
    const guard = guardWith(resolverReturning(null));
    const context = makeContext(ReadController.prototype.read, ReadController, {
      principal,
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('denies with 403 when a required permission is missing', async () => {
    const guard = guardWith(resolverReturning(contextGranting([])));
    const request: Partial<Request> = { principal };
    const context = makeContext(
      ReadController.prototype.read,
      ReadController,
      request,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(request.authorizationContext).toBeUndefined();
  });

  it('allows and attaches the context when the permission is granted', async () => {
    const seen: AuthorizationResolutionRequest[] = [];
    const authContext = contextGranting([Permission.CompaniesRead]);
    const guard = guardWith(
      resolverReturning(authContext, (input) => seen.push(input)),
    );
    const request: Partial<Request> = {
      principal,
      params: { companyId: 'company-9' } as Request['params'],
      headers: {},
    };
    const context = makeContext(
      ReadController.prototype.read,
      ReadController,
      request,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authorizationContext).toBe(authContext);
    // The company id from the request is forwarded to the resolver.
    expect(seen[0].companyId).toBe('company-9');
    expect(seen[0].principal).toBe(principal);
  });

  it('requires every permission when the class and handler both declare some', async () => {
    // Class requires companies.read, handler requires companies.update.
    const guard = guardWith(
      resolverReturning(contextGranting([Permission.CompaniesUpdate])),
    );
    const context = makeContext(
      ScopedController.prototype.update,
      ScopedController,
      { principal },
    );

    // Missing companies.read (class-level) → denied even though the handler
    // permission is present.
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('allows when the merged class and handler permissions are all granted', async () => {
    const guard = guardWith(
      resolverReturning(
        contextGranting([Permission.CompaniesRead, Permission.CompaniesUpdate]),
      ),
    );
    const request: Partial<Request> = { principal };
    const context = makeContext(
      ScopedController.prototype.update,
      ScopedController,
      request,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authorizationContext).toBeDefined();
  });
});
