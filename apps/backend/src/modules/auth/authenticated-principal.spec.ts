import type { JWTPayload } from 'jose';
import { mapClaimsToPrincipal } from './authenticated-principal';
import { InvalidTokenError } from './auth.errors';

describe('mapClaimsToPrincipal', () => {
  it('maps whitelisted identity claims', () => {
    const payload: JWTPayload = {
      sub: 'user-123',
      email: 'a@b.com',
      role: 'authenticated',
      session_id: 'sess-1',
      iat: 1000,
      exp: 2000,
      // Claims that must NOT leak into the principal:
      app_metadata: { role: 'SUPER_ADMIN' },
      user_metadata: { hacked: true },
    };

    const principal = mapClaimsToPrincipal(payload);

    expect(principal).toEqual({
      userId: 'user-123',
      email: 'a@b.com',
      role: 'authenticated',
      sessionId: 'sess-1',
      issuedAt: 1000,
      expiresAt: 2000,
    });
    expect(principal).not.toHaveProperty('app_metadata');
    expect(principal).not.toHaveProperty('user_metadata');
  });

  it('omits absent optional claims', () => {
    const principal = mapClaimsToPrincipal({ sub: 'user-1' });
    expect(principal).toEqual({
      userId: 'user-1',
      email: undefined,
      role: undefined,
      sessionId: undefined,
      issuedAt: undefined,
      expiresAt: undefined,
    });
  });

  it('rejects a token without a subject', () => {
    expect(() => mapClaimsToPrincipal({})).toThrow(InvalidTokenError);
  });

  it('returns a frozen (immutable) principal', () => {
    const principal = mapClaimsToPrincipal({ sub: 'user-1' });
    expect(Object.isFrozen(principal)).toBe(true);
  });
});
