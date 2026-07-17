import { registerAs } from '@nestjs/config';
import { parseBoolean, parseList } from './parse.util';

/**
 * CORS configuration namespace.
 *
 * `origins` is an explicit allowlist. When empty, the bootstrap layer denies
 * cross-origin requests in production and reflects the request origin in
 * non-production for local development convenience. No production origins are
 * invented here.
 */
export const corsConfig = registerAs('cors', () => ({
  origins: parseList(process.env.CORS_ORIGINS),
  credentials: parseBoolean(process.env.CORS_CREDENTIALS, false),
}));
