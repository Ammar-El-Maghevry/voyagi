import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from 'jose';
import type { JWK, JWTVerifyGetKey, KeyLike } from 'jose';

/** A deterministic test signing key with its published public JWK. */
export interface TestSigningKey {
  kid: string;
  alg: string;
  privateKey: KeyLike;
  publicJwk: JWK;
}

/** Generate an asymmetric signing key and its public JWK for tests. */
export async function generateTestKey(
  kid = 'test-key-1',
  alg = 'ES256',
): Promise<TestSigningKey> {
  const { publicKey, privateKey } = await generateKeyPair(alg, {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = alg;
  publicJwk.use = 'sig';
  return { kid, alg, privateKey, publicJwk };
}

/** Build an in-memory JWKS key resolver from one or more test keys. */
export function localJwksResolver(...keys: TestSigningKey[]): JWTVerifyGetKey {
  return createLocalJWKSet({ keys: keys.map((key) => key.publicJwk) });
}

/** Build a JWKS document (as served by a JWKS endpoint) from test keys. */
export function jwksDocument(...keys: TestSigningKey[]): { keys: JWK[] } {
  return { keys: keys.map((key) => key.publicJwk) };
}

export interface SignTokenOptions {
  issuer: string;
  audience: string;
  subject: string;
  /** Expiry; pass `null` to omit the `exp` claim. Default `1h`. */
  expiresIn?: string | number | null;
  /** Optional `nbf` (not-before). */
  notBefore?: string | number;
  /** Extra claims merged into the payload. */
  claims?: Record<string, unknown>;
  /** Override the protected-header algorithm (defaults to the key's alg). */
  headerAlg?: string;
}

/** Sign a Supabase-style access token with a test key. */
export async function signTestToken(
  key: TestSigningKey,
  options: SignTokenOptions,
): Promise<string> {
  let builder = new SignJWT({
    role: 'authenticated',
    ...options.claims,
  })
    .setProtectedHeader({ alg: options.headerAlg ?? key.alg, kid: key.kid })
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setSubject(options.subject)
    .setIssuedAt();

  if (options.expiresIn !== null) {
    builder = builder.setExpirationTime(options.expiresIn ?? '1h');
  }
  if (options.notBefore !== undefined) {
    builder = builder.setNotBefore(options.notBefore);
  }

  return builder.sign(key.privateKey);
}
