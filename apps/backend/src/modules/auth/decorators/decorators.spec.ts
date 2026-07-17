import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  IS_PUBLIC_KEY,
  Public,
} from '../../../common/decorators/public.decorator';
import { PrincipalUnavailableError } from '../auth.errors';
import type { AuthenticatedPrincipal } from '../authenticated-principal';
import { currentPrincipalFactory } from './current-principal.decorator';

describe('@Public', () => {
  it('marks a class as public via metadata', () => {
    @Public()
    class PublicController {}

    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC_KEY, PublicController)).toBe(true);
  });

  it('leaves undecorated classes without the metadata', () => {
    class ProtectedController {}
    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC_KEY, ProtectedController)).toBeUndefined();
  });
});

describe('currentPrincipalFactory', () => {
  function contextWith(principal?: AuthenticatedPrincipal): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ principal }) }),
    } as unknown as ExecutionContext;
  }

  it('returns the attached principal', () => {
    const principal = { userId: 'user-1' } as AuthenticatedPrincipal;
    expect(currentPrincipalFactory(undefined, contextWith(principal))).toBe(
      principal,
    );
  });

  it('throws when no principal is attached (misconfigured route)', () => {
    expect(() => currentPrincipalFactory(undefined, contextWith())).toThrow(
      PrincipalUnavailableError,
    );
  });
});
