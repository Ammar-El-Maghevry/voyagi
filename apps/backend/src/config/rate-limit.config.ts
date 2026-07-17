import { registerAs } from '@nestjs/config';
import { parseInteger } from './parse.util';

/**
 * Rate limiting configuration namespace.
 *
 * `ttl` is the sliding window in milliseconds (the unit `@nestjs/throttler`
 * v6 expects) and `limit` is the request budget per window per client.
 */
export const rateLimitConfig = registerAs('rateLimit', () => ({
  ttl: parseInteger(process.env.RATE_LIMIT_TTL, 60_000),
  limit: parseInteger(process.env.RATE_LIMIT_LIMIT, 100),
}));
