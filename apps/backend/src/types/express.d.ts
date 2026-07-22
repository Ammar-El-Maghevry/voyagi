import 'express';
import type { AuthenticatedPrincipal } from '../modules/auth/authenticated-principal';
import type { AuthorizationContext } from '../modules/authorization/authorization-context';

declare module 'express' {
  interface Request {
    /**
     * Correlation / request identifier attached by the request-id middleware
     * (and reused by the logger). Present for every request.
     */
    id?: string;

    /**
     * Optional client-supplied UUID used to correlate requests across systems.
     * It is absent when the header is missing or invalid and is never generated.
     */
    correlationId?: string;

    /**
     * Verified authenticated principal attached by the authentication guard on
     * protected routes. Absent on public routes.
     */
    principal?: AuthenticatedPrincipal;

    /**
     * Authorization context attached by the authorization guard on routes that
     * declare a permission requirement. Absent otherwise.
     */
    authorizationContext?: AuthorizationContext;
  }
}
