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
    HealthModule,
  ],
  providers: [
    { provide: APP_PIPE, useValue: new ValidationPipe(validationPipeOptions) },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    // Rate limiting runs first, then authentication (secure by default).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthenticationGuard },
  ],
})
export class AppModule {}
