import 'express';
import type { AuthenticatedPrincipal } from '../modules/auth/authenticated-principal';

declare module 'express' {
  interface Request {
    /**
     * Correlation / request identifier attached by the request-id middleware
     * (and reused by the logger). Present for every request.
     */
    id?: string;

    /**
     * Verified authenticated principal attached by the authentication guard on
     * protected routes. Absent on public routes.
     */
    principal?: AuthenticatedPrincipal;
  }
}
