import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

/**
 * Supported runtime environments.
 */
export enum NodeEnvironment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Declarative schema for the environment variables the Phase 1 foundation
 * reads. Validation runs once at startup so the process fails fast on invalid
 * configuration instead of failing unpredictably at request time.
 *
 * Only foundation variables are validated here. Database and authentication
 * variables belong to later phases and are intentionally not required yet.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnvironment)
  NODE_ENV: NodeEnvironment = NodeEnvironment.Development;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(65535)
  PORT = 3000;

  @IsOptional()
  @IsString()
  APP_NAME?: string;

  @IsOptional()
  @IsString()
  BODY_LIMIT?: string;

  @IsOptional()
  @IsString()
  TRUST_PROXY?: string;

  @IsOptional()
  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL?: string;

  @IsOptional()
  @IsString()
  LOG_PRETTY?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  LOG_SLOW_REQUEST_MS?: number;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsString()
  CORS_CREDENTIALS?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_TTL?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_LIMIT?: number;

  @IsOptional()
  @IsString()
  SWAGGER_ENABLED?: string;

  @IsOptional()
  @IsString()
  SWAGGER_PATH?: string;

  // --- Database (Phase 2) ---
  // DATABASE_URL is validated for presence at pool creation (required in
  // production; defaults to the local Supabase stack otherwise), so it is
  // optional at the environment level.
  @IsOptional()
  @IsString()
  DATABASE_URL?: string;

  @IsOptional()
  @IsString()
  DATABASE_APP_NAME?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  DATABASE_POOL_MIN?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  DATABASE_POOL_MAX?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  DATABASE_CONNECTION_TIMEOUT_MS?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  DATABASE_IDLE_TIMEOUT_MS?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  DATABASE_STATEMENT_TIMEOUT_MS?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  DATABASE_READINESS_TIMEOUT_MS?: number;

  @IsOptional()
  @IsIn(['disable', 'require', 'no-verify', 'verify-ca', 'verify-full'])
  DATABASE_SSL_MODE?: string;

  @IsOptional()
  @IsString()
  DATABASE_LOG_QUERIES?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  DATABASE_SLOW_QUERY_MS?: number;

  // --- Supabase Auth (Phase 3) ---
  // Signature verification is asymmetric via the Supabase JWKS endpoint. The
  // issuer/JWKS URL default from SUPABASE_URL; production presence is enforced
  // when the key resolver is created, so these are optional at the env level.
  @IsOptional()
  @IsString()
  SUPABASE_URL?: string;

  @IsOptional()
  @IsString()
  SUPABASE_JWT_ISSUER?: string;

  @IsOptional()
  @IsString()
  SUPABASE_JWKS_URL?: string;

  @IsOptional()
  @IsString()
  SUPABASE_JWT_AUDIENCE?: string;

  @IsOptional()
  @IsString()
  SUPABASE_JWT_ALGORITHMS?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  AUTH_CLOCK_TOLERANCE_SECONDS?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  AUTH_JWKS_CACHE_TTL_MS?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  AUTH_JWKS_TIMEOUT_MS?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  AUTH_JWKS_COOLDOWN_MS?: number;

  // --- Payments (Phase 12 / 18.1) ---
  // Provider registration mode. Production defaults to `disabled` (no adapter);
  // non-production defaults to `test`. Production config validation rejects
  // `test`. The test-provider secret is validated where it is consumed.
  @IsOptional()
  @IsIn(['disabled', 'test'])
  PAYMENTS_PROVIDER_MODE?: string;

  @IsOptional()
  @IsString()
  PAYMENTS_TEST_WEBHOOK_SECRET?: string;

  // --- Shutdown (Phase 18.1) ---
  // Hard deadline (ms) for graceful shutdown before the process force-exits.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(120000)
  SHUTDOWN_TIMEOUT_MS?: number;
}

/**
 * Validate the raw process environment against {@link EnvironmentVariables}.
 * Throws with an aggregated, readable message when validation fails.
 *
 * Wired into `ConfigModule.forRoot({ validate })`.
 */
export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: false,
    forbidUnknownValues: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => {
        const constraints = Object.values(error.constraints ?? {}).join(', ');
        return `  - ${error.property}: ${constraints}`;
      })
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return validated;
}
