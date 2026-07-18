import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { getRequestId } from '../../common/request-context/request-id.util';
import { PrincipalUnavailableError } from '../auth/auth.errors';
import {
  AUTHORIZATION_CONTEXT_RESOLVER,
  type AuthorizationContextResolver,
} from './authorization-context-resolver';
import { AuthorizationDenialReason, ForbiddenError } from './authorization.errors';
import { extractCompanyId } from './company-id.util';
import { REQUIRED_PERMISSIONS_KEY } from './decorators/require-permissions.decorator';
import type { Permission } from './permission.enum';
import { PermissionPolicy } from './policies/permission.policy';
import { PolicyEvaluator } from './policies/policy-evaluator';

/**
 * Global authorization guard.
 *
 * Runs after the authentication guard. For routes that declare a permission
 * requirement (via `@RequirePermissions`) it resolves the caller's
 * {@link AuthorizationContext} through the bound resolver, evaluates the
 * required-permission policy, and attaches the context to the request. Routes
 * with no requirement pass through — authentication alone governs them.
 *
 * It fails closed: a `403` when the caller lacks a permission or no active
 * context can be established. It never returns `401` (that belongs to
 * authentication) and performs no permission logic of its own beyond the policy
 * evaluation.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  private readonly logger = new Logger(AuthorizationGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly evaluator: PolicyEvaluator,
    @Inject(AUTHORIZATION_CONTEXT_RESOLVER)
    private readonly resolver: AuthorizationContextResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Only HTTP requests carry an authorization context; others pass through.
    if (context.getType() !== 'http') {
      return true;
    }

    const required = this.requiredPermissions(context);
    if (required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    // Authorization builds on authentication: a required-permission route must
    // have been authenticated. A missing principal is a route-wiring mistake.
    const principal = request.principal;
    if (!principal) {
      throw new PrincipalUnavailableError();
    }

    const authContext = await this.resolver.resolve({
      principal,
      companyId: extractCompanyId(request),
      requestId: getRequestId(request),
    });
    if (!authContext) {
      this.logDenied(request, AuthorizationDenialReason.ContextUnresolved);
      throw new ForbiddenError(AuthorizationDenialReason.ContextUnresolved);
    }

    const result = this.evaluator.evaluate(
      [new PermissionPolicy(required)],
      authContext,
    );
    if (!result.allowed) {
      this.logDenied(request, result.reason);
      throw new ForbiddenError(result.reason);
    }

    request.authorizationContext = authContext;
    return true;
  }

  /** Combined, de-duplicated permissions required by the class and handler. */
  private requiredPermissions(context: ExecutionContext): Permission[] {
    const merged = this.reflector.getAllAndMerge<Permission[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    return [...new Set(merged)];
  }

  /** Log a sanitized authorization denial. Never logs tokens or permissions payloads. */
  private logDenied(request: Request, reason: string): void {
    this.logger.warn({
      event: 'authorization_denied',
      requestId: getRequestId(request),
      reason,
    });
  }
}
