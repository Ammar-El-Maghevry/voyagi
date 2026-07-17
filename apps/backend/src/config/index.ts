import type { ConfigType } from '@nestjs/config';
import { appConfig } from './app.config';
import { authConfig } from './auth.config';
import { corsConfig } from './cors.config';
import { databaseConfig } from './database.config';
import { loggingConfig } from './logging.config';
import { rateLimitConfig } from './rate-limit.config';
import { swaggerConfig } from './swagger.config';

export { appConfig, GLOBAL_API_PREFIX, DEFAULT_API_VERSION } from './app.config';
export {
  authConfig,
  LOCAL_SUPABASE_URL,
  DEFAULT_JWT_ALGORITHMS,
} from './auth.config';
export { corsConfig } from './cors.config';
export {
  databaseConfig,
  LOCAL_DATABASE_URL,
  type DatabaseSslMode,
} from './database.config';
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
  authConfig,
  corsConfig,
  databaseConfig,
  loggingConfig,
  rateLimitConfig,
  swaggerConfig,
];

/** Strongly-typed views over each configuration namespace. */
export type AppConfig = ConfigType<typeof appConfig>;
export type AuthConfig = ConfigType<typeof authConfig>;
export type CorsConfig = ConfigType<typeof corsConfig>;
export type DatabaseConfig = ConfigType<typeof databaseConfig>;
export type LoggingConfig = ConfigType<typeof loggingConfig>;
export type RateLimitConfig = ConfigType<typeof rateLimitConfig>;
export type SwaggerConfig = ConfigType<typeof swaggerConfig>;
