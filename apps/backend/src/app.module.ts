import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { configurations, validateEnvironment, type RateLimitConfig } from './config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { validationPipeOptions } from './common/validation/validation-pipe.options';
import { DatabaseModule } from './infrastructure/database';
import { buildPinoParams } from './infrastructure/logging/pino-logger.config';
import { AuthModule } from './modules/auth/auth.module';
import { AuthenticationGuard } from './modules/auth/authentication.guard';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { AUTHORIZATION_CONTEXT_RESOLVER } from './modules/authorization/authorization-context-resolver';
import { AuthorizationGuard } from './modules/authorization/authorization.guard';
import { DatabaseAuthorizationContextResolver } from './modules/identity/database-authorization-context.resolver';
import { IdentityModule } from './modules/identity/identity.module';
import { BranchesModule } from './modules/branches/branches.module';
import { StaffModule } from './modules/staff/staff.module';
import { HealthModule } from './modules/health/health.module';

/**
 * Root application module for the Phase 1 foundation.
 *
 * Wires global configuration, structured logging, rate limiting and the
 * cross-cutting pipe/filter/interceptor/guard. Business modules are introduced
 * in later phases.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: configurations,
      validate: validateEnvironment,
      envFilePath: ['.env'],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildPinoParams,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const rateLimit = config.getOrThrow<RateLimitConfig>('rateLimit');
        return [{ ttl: rateLimit.ttl, limit: rateLimit.limit }];
      },
    }),
    DatabaseModule,
    AuthModule,
    AuthorizationModule,
    IdentityModule,
    BranchesModule,
    StaffModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_PIPE, useValue: new ValidationPipe(validationPipeOptions) },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    // Bind the authorization resolver to the database-backed implementation
    // (Phase 5), overriding the permission-less default exported by the
    // authorization module for the app-level authorization guard.
    {
      provide: AUTHORIZATION_CONTEXT_RESOLVER,
      useExisting: DatabaseAuthorizationContextResolver,
    },
    // Guards run in registration order: rate limiting, then authentication
    // (secure by default), then authorization (permission enforcement).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthenticationGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
  ],
})
export class AppModule {}
