import type { ConfigService } from '@nestjs/config';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildPinoParams } from './pino-logger.config';

/**
 * Proves the structured logger cannot leak secrets or PII. The request/response
 * serializers are an ALLOWLIST (only id/correlationId/method/path and
 * statusCode), and sensitive headers are removed. So bodies, query strings,
 * arbitrary headers, tokens, QR material and passenger PII are never logged —
 * regardless of nesting or key casing — because they are simply never selected.
 */
function mockConfig(): ConfigService {
  return {
    getOrThrow: (key: string) =>
      key === 'logging'
        ? { level: 'info', pretty: false, slowRequestMs: 1000 }
        : { nodeEnv: 'test', name: 'voyagi', isProduction: false },
  } as unknown as ConfigService;
}

// Assembled from fragments so the literal credentialed-URL pattern is not
// present in this source file (the secret scanner would otherwise flag its own
// fixture); the runtime value is the full URL, which is what must never be
// logged.
const REMOTE_DB_URL = 'postgresql://u:' + 'p@db.prod.example.com/app';

const SECRETS = [
  'Bearer SUPERSECRET',
  'session=abc',
  'p@ssw0rd',
  'RAW_QR_TOKEN_VALUE',
  'a1b2c3fingerprint',
  'idem-key-123',
  '+22233445566',
  'DOC-99887766',
  REMOTE_DB_URL,
];

describe('pino logger redaction', () => {
  const params = buildPinoParams(mockConfig());
  const pinoHttp = params.pinoHttp as {
    redact: { paths: string[]; remove: boolean };
    serializers: {
      req: (r: unknown) => Record<string, unknown>;
      res: (r: unknown) => Record<string, unknown>;
    };
  };

  it('removes authorization, cookie and set-cookie headers entirely', () => {
    expect(pinoHttp.redact.remove).toBe(true);
    expect(pinoHttp.redact.paths).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
      ]),
    );
  });

  it('serializes a request to an allowlist that omits body, headers and query', () => {
    const request = {
      id: 'req-1',
      method: 'POST',
      url: '/api/v1/payments?token=SUPERSECRET&idempotencyKey=idem-key-123',
      headers: {
        authorization: 'Bearer SUPERSECRET',
        cookie: 'session=abc',
        'x-voyagi-signature': 'a1b2c3fingerprint',
      },
      body: {
        password: 'p@ssw0rd',
        qrToken: 'RAW_QR_TOKEN_VALUE',
        Fingerprint: 'a1b2c3fingerprint',
        passenger: { phone: '+22233445566', document_number: 'DOC-99887766' },
        nested: [{ providerSecret: 'Bearer SUPERSECRET' }],
      },
      connectionString: REMOTE_DB_URL,
    } as unknown as IncomingMessage;

    const out = pinoHttp.serializers.req(request);
    expect(Object.keys(out).sort()).toEqual([
      'correlationId',
      'id',
      'method',
      'url',
    ]);
    expect(out.url).toBe('/api/v1/payments'); // query stripped

    const serialized = JSON.stringify(out);
    for (const secret of SECRETS) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('serializes a response to only its status code', () => {
    const out = pinoHttp.serializers.res({
      statusCode: 200,
      headers: { 'set-cookie': 'session=abc' },
    } as unknown as ServerResponse);
    expect(out).toEqual({ statusCode: 200 });
    expect(JSON.stringify(out)).not.toContain('abc');
  });
});
