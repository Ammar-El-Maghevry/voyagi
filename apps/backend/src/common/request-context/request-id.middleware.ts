import type { NextFunction, Request, Response } from 'express';
import { ensureRequestId } from './request-id.util';

/**
 * Express middleware that guarantees every request carries a request id
 * before any other handler (including the logger) runs.
 *
 * Implemented as a plain function and registered with `app.use()` so it is
 * bound at the very front of the middleware chain, independent of Nest module
 * ordering.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  ensureRequestId(req, res);
  next();
}
