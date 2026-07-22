import type { Request, Response, NextFunction } from 'express';
import type { Logger } from 'nestjs-pino';
import { getCorrelationId } from './correlation-id.util';
import { getRequestId } from './request-id.util';

/** Log completed requests whose total handling time exceeds the configured bound. */
export function slowRequestMiddleware(
  thresholdMs: number,
  logger: Pick<Logger, 'warn'>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next): void => {
    const startedAt = performance.now();
    res.once('finish', () => {
      const durationMs = Math.round(performance.now() - startedAt);
      if (durationMs < thresholdMs) {
        return;
      }

      // A matched route is a template, so it avoids logging query strings or ids.
      const route = typeof req.route?.path === 'string' ? req.route.path : undefined;
      logger.warn({
        event: 'slow_request',
        requestId: getRequestId(req),
        correlationId: getCorrelationId(req),
        method: req.method,
        route,
        statusCode: res.statusCode,
        durationMs,
        thresholdMs,
      });
    });
    next();
  };
}
