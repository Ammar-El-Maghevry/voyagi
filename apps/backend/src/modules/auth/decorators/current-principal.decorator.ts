import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { PrincipalUnavailableError } from '../auth.errors';
import type { AuthenticatedPrincipal } from '../authenticated-principal';

/**
 * Resolve the verified principal from the request (exported for unit testing).
 * Never re-decodes the token and never reads client-supplied identity headers.
 *
 * @throws {PrincipalUnavailableError} when used on a route that is not
 * protected by the authentication guard.
 */
export function currentPrincipalFactory(
  _data: unknown,
  context: ExecutionContext,
): AuthenticatedPrincipal {
  const request = context.switchToHttp().getRequest<Request>();
  if (!request.principal) {
    throw new PrincipalUnavailableError();
  }
  return request.principal;
}

/**
 * Controller parameter decorator returning the verified
 * {@link AuthenticatedPrincipal} attached by the authentication guard.
 */
export const CurrentPrincipal = createParamDecorator(currentPrincipalFactory);
