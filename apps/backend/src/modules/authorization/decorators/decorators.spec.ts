import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthorizationContext } from '../authorization-context';
import { AuthorizationContextMissingError } from '../authorization.errors';
import { Permission } from '../permission.enum';
import { authorizationContextFactory } from './authorization-context.decorator';
import {
  REQUIRED_PERMISSIONS_KEY,
  RequirePermissions,
} from './require-permissions.decorator';

describe('@RequirePermissions', () => {
  const reflector = new Reflector();

  it('stores the required permissions on the handler', () => {
    class Controller {
      @RequirePermissions(Permission.BookingsRead, Permission.BookingsCreate)
      handler(): void {}
    }

    const permissions = reflector.get(
      REQUIRED_PERMISSIONS_KEY,
      Controller.prototype.handler,
    );
    expect(permissions).toEqual([
      Permission.BookingsRead,
      Permission.BookingsCreate,
    ]);
  });

  it('stores an empty array when no permissions are given', () => {
    @RequirePermissions()
    class Controller {}

    expect(reflector.get(REQUIRED_PERMISSIONS_KEY, Controller)).toEqual([]);
  });
});

describe('authorizationContextFactory', () => {
  function contextWith(
    authorizationContext?: AuthorizationContext,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ authorizationContext }) }),
    } as unknown as ExecutionContext;
  }

  it('returns the attached authorization context', () => {
    const authContext = {
      userId: 'user-1',
      profileId: 'profile-1',
      permissions: [],
    } as AuthorizationContext;
    expect(authorizationContextFactory(undefined, contextWith(authContext))).toBe(
      authContext,
    );
  });

  it('throws when no context is attached (misconfigured route)', () => {
    expect(() =>
      authorizationContextFactory(undefined, contextWith()),
    ).toThrow(AuthorizationContextMissingError);
  });
});
