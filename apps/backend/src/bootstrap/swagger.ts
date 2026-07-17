import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { SwaggerConfig } from '../config';

/**
 * Configure Swagger/OpenAPI when enabled by configuration. Adds a bearer-auth
 * placeholder (used from Phase 3 onward) and version metadata. Exposure is
 * controlled by configuration and disabled by default in production.
 */
export function setupSwagger(
  app: INestApplication,
  config: ConfigService,
): void {
  const swagger = config.getOrThrow<SwaggerConfig>('swagger');
  if (!swagger.enabled) {
    return;
  }

  const documentConfig = new DocumentBuilder()
    .setTitle(swagger.title)
    .setDescription(swagger.description)
    .setVersion(swagger.version)
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .build();

  const document = SwaggerModule.createDocument(app, documentConfig);
  SwaggerModule.setup(swagger.path, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}
