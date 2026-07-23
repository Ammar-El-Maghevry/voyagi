import type { ConfigService } from '@nestjs/config';
import { buildCorsOptions } from './cors';

/**
 * CORS policy unit tests. `buildCorsOptions` passes an explicit allowlist to the
 * `cors` library verbatim (which performs exact origin matching, so subdomain /
 * suffix tricks and malformed origins are rejected by construction). These tests
 * pin the security-relevant properties.
 */
function configWith(
  cors: {
    origins: string[];
    credentials: boolean;
  },
  isProduction: boolean,
): ConfigService {
  return {
    getOrThrow: (key: string) => (key === 'cors' ? cors : { isProduction }),
  } as unknown as ConfigService;
}

describe('buildCorsOptions', () => {
  it('denies all origins in production when no allowlist is configured', () => {
    const options = buildCorsOptions(
      configWith({ origins: [], credentials: false }, true),
    );
    expect(options.origin).toBe(false); // no wildcard fallback
  });

  it('uses the exact allowlist verbatim (no wildcard) in production', () => {
    const origins = ['https://app.voyagi.mr', 'https://admin.voyagi.mr'];
    const options = buildCorsOptions(
      configWith({ origins, credentials: true }, true),
    );
    expect(options.origin).toEqual(origins);
    expect(options.origin).not.toBe('*');
    expect(options.origin).not.toBe(true);
  });

  it('reflects the origin only in non-production for local development', () => {
    const options = buildCorsOptions(
      configWith({ origins: [], credentials: false }, false),
    );
    expect(options.origin).toBe(true);
  });

  it('never emits a literal wildcard origin', () => {
    for (const isProd of [true, false]) {
      for (const origins of [[], ['https://x.example']]) {
        const options = buildCorsOptions(
          configWith({ origins, credentials: true }, isProd),
        );
        expect(options.origin).not.toBe('*');
      }
    }
  });

  it('allowlists the required methods and headers (Authorization, Idempotency-Key)', () => {
    const options = buildCorsOptions(
      configWith({ origins: [], credentials: false }, false),
    );
    expect(options.methods).toEqual([
      'GET',
      'POST',
      'PATCH',
      'PUT',
      'DELETE',
      'OPTIONS',
    ]);
    expect(options.allowedHeaders).toEqual(
      expect.arrayContaining([
        'Authorization',
        'Idempotency-Key',
        'Content-Type',
      ]),
    );
    // Never a literal wildcard header set.
    expect(options.allowedHeaders).not.toContain('*');
  });

  it('carries the configured credentials flag', () => {
    expect(
      buildCorsOptions(
        configWith({ origins: ['https://a.example'], credentials: true }, true),
      ).credentials,
    ).toBe(true);
    expect(
      buildCorsOptions(configWith({ origins: [], credentials: false }, false))
        .credentials,
    ).toBe(false);
  });
});
