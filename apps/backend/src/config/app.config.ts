import { registerAs } from '@nestjs/config';
import { parseInteger } from './parse.util';

/** Global route prefix mandated by the API standards (`/api/...`). */
export const GLOBAL_API_PREFIX = 'api';

/** Default URI API version (`/api/v1/...`). */
export const DEFAULT_API_VERSION = '1';

/**
 * Core application configuration namespace.
 */
export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  name: process.env.APP_NAME ?? 'Voyagi API',
  port: parseInteger(process.env.PORT, 3000),
  globalPrefix: GLOBAL_API_PREFIX,
  apiVersion: DEFAULT_API_VERSION,
  bodyLimit: process.env.BODY_LIMIT ?? '100kb',
  // Raw `trust proxy` setting for Express; `undefined` leaves the default off.
  trustProxy: process.env.TRUST_PROXY,
  // Hard deadline (ms) for graceful shutdown before the process force-exits.
  shutdownTimeoutMs: parseInteger(process.env.SHUTDOWN_TIMEOUT_MS, 15_000),
}));
