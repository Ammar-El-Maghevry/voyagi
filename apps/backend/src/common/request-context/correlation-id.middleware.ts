import type { NextFunction, Request, Response } from 'express';
import { ensureCorrelationId } from './correlation-id.util';

/** Resolve an optional UUID correlation id before logging and request handling. */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  ensureCorrelationId(req, res);
  next();
}
