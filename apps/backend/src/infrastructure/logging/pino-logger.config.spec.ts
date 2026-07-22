import type { ConfigService } from '@nestjs/config';
import type { IncomingMessage } from 'node:http';
import { buildPinoParams } from './pino-logger.config';

describe('pino request privacy', () => {
  it('serializes request metadata without passenger bodies, headers, or idempotency keys', () => {
    const config = {
      getOrThrow: (key: string) =>
        key === 'logging'
          ? { level: 'info', pretty: false }
          : { nodeEnv: 'test', name: 'voyagi-test' },
    } as unknown as ConfigService;
    const params = buildPinoParams(config);
    const pinoHttp = params.pinoHttp as {
      serializers: {
        req: (request: IncomingMessage & { id?: unknown }) => unknown;
      };
    };
    const request = {
      id: 'request-1',
      method: 'POST',
      url: '/api/v1/bookings',
      headers: { 'idempotency-key': 'private-key' },
      body: {
        passengers: [
          {
            fullName: 'Private Passenger',
            phone: '+22236000000',
            documentNumber: 'PRIVATE-DOCUMENT',
          },
        ],
      },
    } as unknown as IncomingMessage & { id?: unknown };

    const serialized = pinoHttp.serializers.req(request);
    expect(serialized).toEqual({
      id: 'request-1',
      method: 'POST',
      url: '/api/v1/bookings',
    });
    expect(JSON.stringify(serialized)).not.toMatch(
      /Private Passenger|36000000|PRIVATE-DOCUMENT|private-key/i,
    );
  });
});
