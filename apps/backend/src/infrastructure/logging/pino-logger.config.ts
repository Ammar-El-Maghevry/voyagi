import { ConfigService } from '@nestjs/config';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppConfig, LoggingConfig } from '../../config';
import { getCorrelationId } from '../../common/request-context/correlation-id.util';
import { ensureRequestId } from '../../common/request-context/request-id.util';

/**
 * Build the `nestjs-pino` parameters from typed configuration.
 *
 * Produces structured logs that include the request id, method, path, status
 * and duration, tagged with the environment. Credentials and cookies are
 * redacted and never written to the log stream.
 */
export function buildPinoParams(config: ConfigService): Params {
  const logging = config.getOrThrow<LoggingConfig>('logging');
  const app = config.getOrThrow<AppConfig>('app');

  return {
    pinoHttp: {
      level: logging.level,
      // Reuse the id attached by the request-id middleware (or resolve it here
      // if the logger happens to run first). Also echoes the response header.
      genReqId: (req: IncomingMessage, res: ServerResponse) =>
        ensureRequestId(
          req as IncomingMessage & { id?: unknown },
          res as ServerResponse,
        ),
      customProps: (req) => ({
        environment: app.nodeEnv,
        service: app.name,
        correlationId: getCorrelationId(
          req as IncomingMessage & { correlationId?: unknown },
        ),
      }),
      autoLogging: true,
      // Never log secrets: strip auth headers and cookies entirely.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
        ],
        remove: true,
      },
      serializers: {
        req(req: IncomingMessage & { id?: unknown; correlationId?: unknown }) {
          return {
            id: req.id,
            correlationId: getCorrelationId(req),
            method: req.method,
            url: req.url,
          };
        },
        res(res: ServerResponse) {
          return { statusCode: res.statusCode };
        },
      },
      transport: logging.pretty
        ? {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'SYS:standard' },
          }
        : undefined,
    },
  };
}
