import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { AuthConfig } from '../../config';

/** DI token for the JWKS key resolver used to verify token signatures. */
export const AUTH_KEY_RESOLVER = Symbol('AUTH_KEY_RESOLVER');

/** A `jose` key-getter that resolves the correct public key for a token. */
export type AuthKeyResolver = JWTVerifyGetKey;

/**
 * Build the remote JWKS key resolver from configuration.
 *
 * Fails fast when no JWKS URL is available (mandatory in production). The
 * resolver is lazy — it fetches keys on first use, not at bootstrap — and
 * `jose` handles caching, key rotation (refetch on unknown `kid`, with a
 * cooldown) and a bounded fetch timeout internally.
 */
export function createJwksKeyResolver(config: ConfigService): AuthKeyResolver {
  const auth = config.getOrThrow<AuthConfig>('auth');

  if (!auth.jwksUrl) {
    throw new Error(
      'Supabase JWKS URL is required but was not provided. Set SUPABASE_URL or ' +
        'SUPABASE_JWKS_URL explicitly (mandatory in production).',
    );
  }

  return createRemoteJWKSet(new URL(auth.jwksUrl), {
    timeoutDuration: auth.jwksTimeoutMs,
    cacheMaxAge: auth.jwksCacheTtlMs,
    cooldownDuration: auth.jwksCooldownMs,
  });
}
