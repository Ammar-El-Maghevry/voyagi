import {
  MalformedAuthorizationHeaderError,
  MissingCredentialsError,
} from './auth.errors';
import { extractBearerToken } from './bearer-token.util';

describe('extractBearerToken', () => {
  it('extracts a valid Bearer token', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('accepts the scheme case-insensitively', () => {
    expect(extractBearerToken('bearer token123')).toBe('token123');
  });

  it('rejects a missing header as missing credentials', () => {
    expect(() => extractBearerToken(undefined)).toThrow(MissingCredentialsError);
  });

  it('rejects an empty header as missing credentials', () => {
    expect(() => extractBearerToken('   ')).toThrow(MissingCredentialsError);
  });

  it('rejects a non-Bearer scheme as malformed', () => {
    expect(() => extractBearerToken('Basic abc')).toThrow(
      MalformedAuthorizationHeaderError,
    );
  });

  it('rejects a Bearer scheme with no token', () => {
    expect(() => extractBearerToken('Bearer')).toThrow(
      MalformedAuthorizationHeaderError,
    );
  });

  it('rejects multiple comma-separated credentials as malformed', () => {
    expect(() => extractBearerToken('Bearer a, Bearer b')).toThrow(
      MalformedAuthorizationHeaderError,
    );
  });

  it('rejects ambiguous multiple header values (array) as malformed', () => {
    expect(() => extractBearerToken(['Bearer a', 'Bearer b'])).toThrow(
      MalformedAuthorizationHeaderError,
    );
  });
});
