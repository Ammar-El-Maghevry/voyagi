import { registerAs } from '@nestjs/config';
import { parseInteger, parseList } from './parse.util';

/**
 * Local Supabase base URL used as a safe default outside production so the app
 * and tests resolve the issuer/JWKS without extra configuration. Production
 * must set `SUPABASE_URL` (or the explicit issuer/JWKS URLs); this is enforced
 * when the JWKS key resolver is created.
 */
export const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';

/**
 * Asymmetric signing algorithms accepted for Supabase access tokens. Symmetric
 * (`HS*`) and `none` are intentionally excluded — verification is JWKS-based.
 */
export const DEFAULT_JWT_ALGORITHMS = ['RS256', 'ES256'];

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Authentication configuration namespace (Supabase-issued JWT verification).
 *
 * Verification is asymmetric via the Supabase JWKS endpoint — no shared secret
 * is used or accepted. Issuer and JWKS URL default from `SUPABASE_URL` but can
 * be overridden explicitly. No secret or token value is ever stored here.
 */
export const authConfig = registerAs('auth', () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const supabaseUrl =
    process.env.SUPABASE_URL ?? (isProduction ? '' : LOCAL_SUPABASE_URL);
  const base = supabaseUrl ? stripTrailingSlashes(supabaseUrl) : '';

  const algorithms = parseList(process.env.SUPABASE_JWT_ALGORITHMS);

  return {
    supabaseUrl,
    issuer: process.env.SUPABASE_JWT_ISSUER ?? (base ? `${base}/auth/v1` : ''),
    jwksUrl:
      process.env.SUPABASE_JWKS_URL ??
      (base ? `${base}/auth/v1/.well-known/jwks.json` : ''),
    audience: process.env.SUPABASE_JWT_AUDIENCE ?? 'authenticated',
    algorithms: algorithms.length > 0 ? algorithms : DEFAULT_JWT_ALGORITHMS,
    clockToleranceSeconds: parseInteger(
      process.env.AUTH_CLOCK_TOLERANCE_SECONDS,
      5,
    ),
    jwksCacheTtlMs: parseInteger(process.env.AUTH_JWKS_CACHE_TTL_MS, 600_000),
    jwksTimeoutMs: parseInteger(process.env.AUTH_JWKS_TIMEOUT_MS, 5_000),
    jwksCooldownMs: parseInteger(process.env.AUTH_JWKS_COOLDOWN_MS, 30_000),
  };
});
