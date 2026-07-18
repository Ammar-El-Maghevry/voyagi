import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthorizationContext } from '../authorization-context';
import { AuthorizationContextMissingError } from '../authorization.errors';

/**
 * Resolve the authorization context from the request (exported for unit
 * testing). Never re-derives permissions and never reads client-supplied
 * identity data.
 *
 * @throws {AuthorizationContextMissingError} when used on a route that the
 * authorization guard did not resolve a context for (i.e. it declares no
 * permission requirement).
 */
export function authorizationContextFactory(
  _data: unknown,
  context: ExecutionContext,
): AuthorizationContext {
  const request = context.switchToHttp().getRequest<Request>();
  if (!request.authorizationContext) {
    throw new AuthorizationContextMissingError();
  }
  return request.authorizationContext;
}

/**
 * Controller parameter decorator returning the {@link AuthorizationContext}
 * attached by the authorization guard (tenant, membership, role, permissions).
 */
export const AuthorizationCtx = createParamDecorator(
  authorizationContextFactory,
);
