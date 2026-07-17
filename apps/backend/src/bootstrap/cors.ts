import { ConfigService } from '@nestjs/config';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { AppConfig, CorsConfig } from '../config';
import { REQUEST_ID_HEADER } from '../common/constants/request.constants';

/**
 * Build CORS options from configuration.
 *
 * When an explicit origin allowlist is provided it is used verbatim. When none
 * is configured, production denies all cross-origin requests (no origins are
 * invented) while non-production reflects the request origin for local
 * development convenience.
 */
export function buildCorsOptions(config: ConfigService): CorsOptions {
  const cors = config.getOrThrow<CorsConfig>('cors');
  const app = config.getOrThrow<AppConfig>('app');

  const origin =
    cors.origins.length > 0 ? cors.origins : app.isProduction ? false : true;

  return {
    origin,
    credentials: cors.credentials,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Company-Id',
      REQUEST_ID_HEADER,
    ],
    exposedHeaders: [REQUEST_ID_HEADER],
  };
}
