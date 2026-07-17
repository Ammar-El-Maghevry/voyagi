import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from './authenticated-principal';
import { CurrentPrincipal } from './decorators/current-principal.decorator';
import { PrincipalResponseDto } from './dto/principal-response.dto';

/**
 * Authentication endpoints. Protected by the global authentication guard.
 *
 * `GET /api/v1/auth/me` returns a safe subset of the verified principal. It
 * does not resolve the profile record or any authorization data — that belongs
 * to later phases.
 */
@ApiTags('auth')
@ApiBearerAuth('bearer')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  @Get('me')
  @ApiOperation({
    summary: 'Return the authenticated principal from the verified access token.',
  })
  @ApiOkResponse({ type: PrincipalResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Missing, malformed, expired, or invalid credentials.',
  })
  me(@CurrentPrincipal() principal: AuthenticatedPrincipal): PrincipalResponseDto {
    return {
      userId: principal.userId,
      email: principal.email,
      role: principal.role,
      expiresAt: principal.expiresAt,
    };
  }
}
