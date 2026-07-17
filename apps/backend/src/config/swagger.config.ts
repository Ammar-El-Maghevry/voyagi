import { registerAs } from '@nestjs/config';
import { parseBoolean } from './parse.util';

/**
 * OpenAPI / Swagger configuration namespace.
 *
 * Exposure is toggled by configuration and defaults to disabled in production
 * so API documentation is not published by accident.
 */
export const swaggerConfig = registerAs('swagger', () => {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    enabled: parseBoolean(process.env.SWAGGER_ENABLED, !isProduction),
    path: process.env.SWAGGER_PATH ?? 'api/docs',
    title: 'Voyagi API',
    description:
      'Voyagi multi-tenant intercity bus transportation platform API.',
    version: process.env.npm_package_version ?? '1.0.0',
  };
});
