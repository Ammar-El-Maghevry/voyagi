import { ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticationGuard } from './authentication.guard';
import { InvalidTokenError, AuthErrorReason } from './auth.errors';
import type { AuthenticatedPrincipal } from './authenticated-principal';
import type { JwtVerifierService } from './jwt-verifier.service';

interface FakeRequest {
  headers: Record<string, string | string[] | undefined>;
  id?: string;
  principal?: AuthenticatedPrincipal;
}

function contextFor(request: FakeRequest): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guardWith(
  verify: jest.Mock,
  isPublic = false,
): { guard: AuthenticationGuard; verify: jest.Mock } {
  const reflector = {
    getAllAndOverride: () => isPublic,
  } as unknown as Reflector;
  const verifier = { verify } as unknown as JwtVerifierService;
  return { guard: new AuthenticationGuard(reflector, verifier), verify };
}

describe('AuthenticationGuard', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warnSpy.mockRestore());

  it('allows public routes without verifying a token', async () => {
    const verify = jest.fn();
    const { guard } = guardWith(verify, true);
    const request: FakeRequest = { headers: {} };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it('verifies the token and attaches the principal on success', async () => {
    const principal = { userId: 'user-1' } as AuthenticatedPrincipal;
    const verify = jest.fn().mockResolvedValue(principal);
    const { guard } = guardWith(verify);
    const request: FakeRequest = { headers: { authorization: 'Bearer good' } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('good');
    expect(request.principal).toBe(principal);
  });

  it('rejects a request with no credentials (401)', async () => {
    const { guard } = guardWith(jest.fn());
    const request: FakeRequest = { headers: {} };

    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({
      reason: AuthErrorReason.MissingCredentials,
    });
  });

  it('propagates verification failures and logs sanitized details only', async () => {
    const verify = jest
      .fn()
      .mockRejectedValue(new InvalidTokenError(AuthErrorReason.SignatureInvalid));
    const { guard } = guardWith(verify);
    const request: FakeRequest = {
      headers: { authorization: 'Bearer secret-token-value' },
      id: 'req-9',
    };

    await expect(
      guard.canActivate(contextFor(request)),
    ).rejects.toBeInstanceOf(InvalidTokenError);

    // The log must not contain the token or the Authorization header.
    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).not.toContain('secret-token-value');
    expect(logged).not.toContain('Bearer');
    expect(logged).toContain('signature_invalid');
  });
});
