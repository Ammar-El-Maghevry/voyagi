import { REQUEST_ID_HEADER } from '../constants/request.constants';
import {
  ensureRequestId,
  getRequestId,
  isValidRequestId,
} from './request-id.util';

interface FakeRequest {
  id?: unknown;
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('isValidRequestId', () => {
  it('accepts safe, bounded tokens', () => {
    expect(isValidRequestId('abc-123_DEF.4')).toBe(true);
  });

  it('rejects empty, oversized and unsafe values', () => {
    expect(isValidRequestId('')).toBe(false);
    expect(isValidRequestId('a'.repeat(129))).toBe(false);
    expect(isValidRequestId('bad value\nwith spaces')).toBe(false);
    expect(isValidRequestId(42)).toBe(false);
    expect(isValidRequestId(undefined)).toBe(false);
  });
});

describe('ensureRequestId', () => {
  it('generates a UUID when no id is present', () => {
    const req: FakeRequest = { headers: {} };
    const res = createResponse();

    const id = ensureRequestId(req, res);

    expect(id).toMatch(UUID_PATTERN);
    expect(req.id).toBe(id);
    expect(res.headers[REQUEST_ID_HEADER]).toBe(id);
  });

  it('accepts a valid incoming request-id header', () => {
    const req: FakeRequest = { headers: { [REQUEST_ID_HEADER]: 'client-123' } };
    const res = createResponse();

    const id = ensureRequestId(req, res);

    expect(id).toBe('client-123');
    expect(res.headers[REQUEST_ID_HEADER]).toBe('client-123');
  });

  it('ignores an invalid incoming header and generates a UUID', () => {
    const req: FakeRequest = {
      headers: { [REQUEST_ID_HEADER]: 'invalid value!' },
    };
    const res = createResponse();

    const id = ensureRequestId(req, res);

    expect(id).toMatch(UUID_PATTERN);
  });

  it('is idempotent: reuses an already-attached id', () => {
    const req: FakeRequest = { id: 'existing-id', headers: {} };
    const res = createResponse();

    const id = ensureRequestId(req, res);

    expect(id).toBe('existing-id');
  });
});

describe('getRequestId', () => {
  it('returns the id when valid and an empty string otherwise', () => {
    expect(getRequestId({ id: 'abc' })).toBe('abc');
    expect(getRequestId({})).toBe('');
  });
});
