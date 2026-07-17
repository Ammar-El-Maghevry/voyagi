import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthenticationGuard } from './authentication.guard';
import {
  AUTH_KEY_RESOLVER,
  createJwksKeyResolver,
} from './jwks-key-resolver.provider';
import { JwtVerifierService } from './jwt-verifier.service';

/**
 * Authentication module.
 *
 * Provides the JWKS key resolver and JWT verifier, and exposes the reusable
 * {@link AuthenticationGuard} (registered globally by the app module). It
 * performs token verification only — no authorization, tenant, or profile
 * resolution.
 */
@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: AUTH_KEY_RESOLVER,
      inject: [ConfigService],
      useFactory: createJwksKeyResolver,
    },
    JwtVerifierService,
    AuthenticationGuard,
  ],
  exports: [JwtVerifierService, AuthenticationGuard],
})
export class AuthModule {}
