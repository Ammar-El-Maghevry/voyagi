import type { ConfigType } from '@nestjs/config';
import { appConfig } from './app.config';
import { corsConfig } from './cors.config';
import { loggingConfig } from './logging.config';
import { rateLimitConfig } from './rate-limit.config';
import { swaggerConfig } from './swagger.config';

export { appConfig, GLOBAL_API_PREFIX, DEFAULT_API_VERSION } from './app.config';
export { corsConfig } from './cors.config';
export { loggingConfig } from './logging.config';
export { rateLimitConfig } from './rate-limit.config';
export { swaggerConfig } from './swagger.config';
export {
  EnvironmentVariables,
  NodeEnvironment,
  validateEnvironment,
} from './env.validation';

/**
 * All configuration namespaces, loaded by `ConfigModule.forRoot`.
 */
export const configurations = [
  appConfig,
  corsConfig,
  loggingConfig,
  rateLimitConfig,
  swaggerConfig,
];

/** Strongly-typed views over each configuration namespace. */
export type AppConfig = ConfigType<typeof appConfig>;
export type CorsConfig = ConfigType<typeof corsConfig>;
export type LoggingConfig = ConfigType<typeof loggingConfig>;
export type RateLimitConfig = ConfigType<typeof rateLimitConfig>;
export type SwaggerConfig = ConfigType<typeof swaggerConfig>;
