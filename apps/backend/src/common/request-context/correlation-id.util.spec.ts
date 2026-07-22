import { CORRELATION_ID_HEADER } from '../constants/request.constants';
import {
  ensureCorrelationId,
  getCorrelationId,
  isValidUuid,
} from './correlation-id.util';

interface FakeRequest {
  correlationId?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

function createResponse() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  };
}

const UUID = '8a5e3649-17c2-4b0c-b858-7293f05458d2';

describe('correlation ids', () => {
  it('accepts and echoes a UUID header without changing it', () => {
    const request: FakeRequest = {
      headers: { [CORRELATION_ID_HEADER]: UUID },
    };
    const response = createResponse();

    expect(ensureCorrelationId(request, response)).toBe(UUID);
    expect(request.correlationId).toBe(UUID);
    expect(response.headers[CORRELATION_ID_HEADER]).toBe(UUID);
  });

  it('does not fabricate or echo an invalid correlation id', () => {
    const request: FakeRequest = {
      headers: { [CORRELATION_ID_HEADER]: 'not-a-uuid' },
    };
    const response = createResponse();

    expect(ensureCorrelationId(request, response)).toBeUndefined();
    expect(request.correlationId).toBeUndefined();
    expect(response.headers[CORRELATION_ID_HEADER]).toBeUndefined();
  });

  it('validates UUIDs before exposing them', () => {
    expect(isValidUuid(UUID)).toBe(true);
    expect(isValidUuid('request-123')).toBe(false);
    expect(getCorrelationId({ correlationId: 'request-123' })).toBeUndefined();
  });
});
