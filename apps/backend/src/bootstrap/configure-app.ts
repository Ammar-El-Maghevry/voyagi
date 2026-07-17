import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { AppConfig } from '../config';
import { requestIdMiddleware } from '../common/request-context/request-id.middleware';
import { buildCorsOptions } from './cors';
import { setupSwagger } from './swagger';

/** Resolve Express's `trust proxy` value from its raw string form. */
function resolveTrustProxy(raw: string): boolean | number | string {
  const numeric = Number(raw);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  return raw;
}

/**
 * Apply every runtime concern to a created Nest application: logging, security
 * baseline, body limits, versioning, validation-adjacent wiring and Swagger.
 *
 * Shared by `main.ts` and the e2e suite so tests exercise the exact production
 * configuration. Does not call `listen`.
 */
export function configureApp(app: NestExpressApplication): void {
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  const appConfig = config.getOrThrow<AppConfig>('app');

  const expressInstance = app.getHttpAdapter().getInstance();
  expressInstance.disable('x-powered-by');
  if (appConfig.trustProxy !== undefined) {
    expressInstance.set('trust proxy', resolveTrustProxy(appConfig.trustProxy));
  }

  // Correlation id must be assigned before anything else runs.
  app.use(requestIdMiddleware);

  // Security baseline.
  app.use(helmet());
  app.enableCors(buildCorsOptions(config));

  // Bounded request bodies.
  app.useBodyParser('json', { limit: appConfig.bodyLimit });
  app.useBodyParser('urlencoded', {
    limit: appConfig.bodyLimit,
    extended: true,
  });

  // API surface: `/api` prefix + URI versioning (`/api/v1/...`).
  app.setGlobalPrefix(appConfig.globalPrefix);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: appConfig.apiVersion,
  });

  setupSwagger(app, config);

  app.enableShutdownHooks();
}
