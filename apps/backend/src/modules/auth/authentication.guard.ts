import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { getRequestId } from '../../common/request-context/request-id.util';
import { AuthenticationError } from './auth.errors';
import { extractBearerToken } from './bearer-token.util';
import { JwtVerifierService } from './jwt-verifier.service';

/**
 * Global authentication guard (secure by default).
 *
 * For every non-public HTTP route it extracts the Bearer token, verifies it,
 * and attaches the resulting {@link AuthenticatedPrincipal} to the request.
 * Failures throw stable authentication errors (401, or 503 when verification
 * infrastructure is unavailable) — never 403, which is reserved for
 * authorization. It performs no database or business-table access.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  private readonly logger = new Logger(AuthenticationGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifierService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }
    // Only HTTP requests carry Bearer credentials; other contexts pass through.
    if (context.getType() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const startedAt = Date.now();

    try {
      const token = extractBearerToken(request.headers.authorization);
      request.principal = await this.verifier.verify(token);
      return true;
    } catch (error) {
      this.logFailure(error, request, Date.now() - startedAt);
      throw error;
    }
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }

  /** Log a sanitized authentication failure. Never logs the token or header. */
  private logFailure(
    error: unknown,
    request: Request,
    durationMs: number,
  ): void {
    const reason =
      error instanceof AuthenticationError ? error.reason : 'unknown';
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    this.logger.warn({
      event: 'authentication_failed',
      requestId: getRequestId(request),
      reason,
      status,
      durationMs,
    });
  }
}
