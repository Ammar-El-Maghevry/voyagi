import type { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import {
  generateTestKey,
  localJwksResolver,
  signTestToken,
  type TestSigningKey,
} from '../../../test/support/auth-test-keys';
import {
  AuthErrorReason,
  InvalidTokenError,
  JwksUnavailableError,
  TokenExpiredError,
} from './auth.errors';
import { JwtVerifierService } from './jwt-verifier.service';

const ISSUER = 'https://iss/auth/v1';
const AUDIENCE = 'authenticated';
const nowSec = () => Math.floor(Date.now() / 1000);

function buildVerifier(
  resolver: JWTVerifyGetKey,
  algorithms: string[] = ['ES256'],
): JwtVerifierService {
  const config = {
    getOrThrow: () => ({
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms,
      clockToleranceSeconds: 0,
    }),
  } as unknown as ConfigService;
  return new JwtVerifierService(resolver, config);
}

describe('JwtVerifierService', () => {
  let key: TestSigningKey;
  let verifier: JwtVerifierService;

  beforeAll(async () => {
    key = await generateTestKey('key-1', 'ES256');
    verifier = buildVerifier(localJwksResolver(key));
  });

  const validToken = () =>
    signTestToken(key, { issuer: ISSUER, audience: AUDIENCE, subject: 'user-1' });

  it('verifies a valid token and returns the principal', async () => {
    const principal = await verifier.verify(await validToken());
    expect(principal.userId).toBe('user-1');
    expect(principal.role).toBe('authenticated');
  });

  it('rejects an expired token as TOKEN_EXPIRED', async () => {
    const token = await signTestToken(key, {
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: 'user-1',
      expiresIn: nowSec() - 3600,
    });
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(
      TokenExpiredError,
    );
  });

  it('rejects a not-yet-valid token', async () => {
    const token = await signTestToken(key, {
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: 'user-1',
      notBefore: nowSec() + 3600,
    });
    await expect(verifier.verify(token)).rejects.toMatchObject({
      reason: AuthErrorReason.NotYetValid,
    });
  });

  it('rejects a wrong issuer', async () => {
    const token = await signTestToken(key, {
      issuer: 'https://evil/auth/v1',
      audience: AUDIENCE,
      subject: 'user-1',
    });
    await expect(verifier.verify(token)).rejects.toMatchObject({
      reason: AuthErrorReason.IssuerMismatch,
    });
  });

  it('rejects a wrong audience', async () => {
    const token = await signTestToken(key, {
      issuer: ISSUER,
      audience: 'someone-else',
      subject: 'user-1',
    });
    await expect(verifier.verify(token)).rejects.toMatchObject({
      reason: AuthErrorReason.AudienceMismatch,
    });
  });

  it('rejects a disallowed algorithm', async () => {
    const rs256Only = buildVerifier(localJwksResolver(key), ['RS256']);
    await expect(rs256Only.verify(await validToken())).rejects.toMatchObject({
      reason: AuthErrorReason.AlgorithmNotAllowed,
    });
  });

  it('rejects an invalid signature (key mismatch)', async () => {
    const otherKey = await generateTestKey('key-1', 'ES256'); // same kid, different key
    const verifierWithWrongKey = buildVerifier(localJwksResolver(otherKey));
    await expect(
      verifierWithWrongKey.verify(await validToken()),
    ).rejects.toMatchObject({ reason: AuthErrorReason.SignatureInvalid });
  });

  it('rejects an unknown signing key (kid)', async () => {
    const unknownKey = await generateTestKey('unknown-kid', 'ES256');
    const verifierWithoutKey = buildVerifier(localJwksResolver(unknownKey));
    await expect(
      verifierWithoutKey.verify(await validToken()),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('rejects a malformed token', async () => {
    await expect(verifier.verify('not.a.jwt')).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it('rejects a token with no subject', async () => {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: key.alg, kid: key.kid })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key.privateKey);
    await expect(verifier.verify(token)).rejects.toMatchObject({
      reason: AuthErrorReason.SubjectMissing,
    });
  });

  it('maps JWKS infrastructure failures to a dependency error (fail closed)', async () => {
    const failingResolver: JWTVerifyGetKey = () => {
      throw Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
    };
    const verifierWithoutJwks = buildVerifier(failingResolver);
    await expect(
      verifierWithoutJwks.verify(await validToken()),
    ).rejects.toBeInstanceOf(JwksUnavailableError);
  });
});
