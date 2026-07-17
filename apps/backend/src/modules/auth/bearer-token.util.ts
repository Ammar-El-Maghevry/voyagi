import {
  MalformedAuthorizationHeaderError,
  MissingCredentialsError,
} from './auth.errors';

/** RFC 6750 scheme, matched case-insensitively. */
const BEARER_SCHEME = /^Bearer$/i;

/**
 * Strictly extract a Bearer token from an Authorization header value.
 *
 * Accepts only a single `Authorization: Bearer <token>` value. Rejects missing
 * credentials, malformed schemes, empty tokens, and ambiguous multiple values.
 * Tokens are never read from query parameters or cookies, and the token is
 * never logged here.
 *
 * @throws {MissingCredentialsError} when no credentials are present
 * @throws {MalformedAuthorizationHeaderError} when the header is malformed
 */
export function extractBearerToken(
  header: string | string[] | undefined,
): string {
  if (header === undefined) {
    throw new MissingCredentialsError();
  }

  // Multiple Authorization header values are ambiguous and rejected.
  if (Array.isArray(header)) {
    throw new MalformedAuthorizationHeaderError();
  }

  const trimmed = header.trim();
  if (trimmed === '') {
    throw new MissingCredentialsError();
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2 || !BEARER_SCHEME.test(parts[0])) {
    throw new MalformedAuthorizationHeaderError();
  }

  const token = parts[1];
  if (token.length === 0) {
    throw new MissingCredentialsError();
  }

  return token;
}
