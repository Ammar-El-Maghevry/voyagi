import { Throttle } from '@nestjs/throttler';
import { parseInteger } from '../../config/parse.util';

/**
 * Per-category rate-limit policies.
 *
 * Exact production limits are NOT documented by the architecture, so every
 * category defaults to the existing global limit (`RATE_LIMIT_LIMIT`) and is
 * overridable by an explicit environment variable for stricter tuning. No
 * production-specific limit is invented here. The shared window is
 * `RATE_LIMIT_TTL`. Values are resolved at load time so `@Throttle` can bake
 * them per route; tests set the env before importing the app.
 */
const TTL = parseInteger(process.env.RATE_LIMIT_TTL, 60_000);
const GLOBAL_LIMIT = parseInteger(process.env.RATE_LIMIT_LIMIT, 100);

function limitFor(envVar: string): number {
  return parseInteger(process.env[envVar], GLOBAL_LIMIT);
}

export type RateLimitCategory =
  | 'publicRead'
  | 'authenticatedRead'
  | 'write'
  | 'booking'
  | 'paymentInit'
  | 'paymentConfirm'
  | 'refund'
  | 'webhook'
  | 'ticketVerify'
  | 'ticketValidate'
  | 'auditRead';

const ENV_BY_CATEGORY: Record<RateLimitCategory, string> = {
  publicRead: 'RATE_LIMIT_PUBLIC_READ',
  authenticatedRead: 'RATE_LIMIT_AUTH_READ',
  write: 'RATE_LIMIT_WRITE',
  booking: 'RATE_LIMIT_BOOKING',
  paymentInit: 'RATE_LIMIT_PAYMENT_INIT',
  paymentConfirm: 'RATE_LIMIT_PAYMENT_CONFIRM',
  refund: 'RATE_LIMIT_REFUND',
  webhook: 'RATE_LIMIT_WEBHOOK',
  ticketVerify: 'RATE_LIMIT_TICKET_VERIFY',
  ticketValidate: 'RATE_LIMIT_TICKET_VALIDATE',
  auditRead: 'RATE_LIMIT_AUDIT_READ',
};

/** Resolve the {limit, ttl} for a category from configuration. */
export function policyFor(category: RateLimitCategory): {
  limit: number;
  ttl: number;
} {
  return { limit: limitFor(ENV_BY_CATEGORY[category]), ttl: TTL };
}

/**
 * Apply the configured rate-limit policy for a category to a route (overrides
 * the global default throttler for that handler).
 */
export function RateLimit(
  category: RateLimitCategory,
): MethodDecorator & ClassDecorator {
  return Throttle({ default: policyFor(category) });
}
