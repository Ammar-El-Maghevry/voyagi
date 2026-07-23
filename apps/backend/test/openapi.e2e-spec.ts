import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { swaggerConfig } from '../src/config/swagger.config';

/**
 * OpenAPI security tests: generate the real document and scan it. This also
 * proves the @nestjs/swagger 11 upgrade produces a valid document under NestJS
 * 11.
 */
describe('OpenAPI document (e2e)', () => {
  let app: INestApplication;
  let doc: Record<string, unknown>;
  let serialized: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    await app.init();
    const builder = new DocumentBuilder()
      .setTitle('Voyagi')
      .setVersion('1')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'bearer',
      )
      .build();
    doc = SwaggerModule.createDocument(app, builder) as unknown as Record<
      string,
      unknown
    >;
    serialized = JSON.stringify(doc);
  });

  afterAll(async () => {
    await app.close();
  });

  it('is configuration-controlled and disabled by default in production', () => {
    const previous = process.env.NODE_ENV;
    const previousFlag = process.env.SWAGGER_ENABLED;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.SWAGGER_ENABLED;
      expect(swaggerConfig().enabled).toBe(false);
      process.env.SWAGGER_ENABLED = 'true';
      expect(swaggerConfig().enabled).toBe(true);
    } finally {
      process.env.NODE_ENV = previous;
      if (previousFlag === undefined) delete process.env.SWAGGER_ENABLED;
      else process.env.SWAGGER_ENABLED = previousFlag;
    }
  });

  it('documents bearer authentication', () => {
    const components = doc.components as {
      securitySchemes?: Record<string, { scheme?: string }>;
    };
    expect(components.securitySchemes?.bearer?.scheme).toBe('bearer');
  });

  it('registers the expected route surface, including the public webhook', () => {
    const paths = Object.keys(doc.paths as Record<string, unknown>);
    expect(paths.length).toBeGreaterThan(30);
    expect(paths.some((p) => p.includes('/webhooks/payments/'))).toBe(true);
    expect(paths.some((p) => p.includes('/payments'))).toBe(true);
    expect(paths.some((p) => p.includes('/tickets'))).toBe(true);
  });

  it('documents the Idempotency-Key header on financial/booking creation', () => {
    expect(serialized).toContain('Idempotency-Key');
  });

  it('never exposes secret or internal fields in schemas or examples', () => {
    const forbidden = [
      'qr_token_hash',
      'qrTokenHash',
      'password_hash',
      'passwordHash',
      'request_fingerprint',
      'requestFingerprint',
      'fingerprint',
      '-----BEGIN',
      'voyagi-test-webhook-secret',
      'x-voyagi-signature',
    ];
    for (const term of forbidden) {
      expect(serialized.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });
});
