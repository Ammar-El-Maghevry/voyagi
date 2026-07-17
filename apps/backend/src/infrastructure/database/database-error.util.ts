/** Node.js socket-level error codes that indicate the database is unreachable. */
const NODE_CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

/**
 * Extract the error `code` (PostgreSQL SQLSTATE, e.g. `23505`, or a Node error
 * code, e.g. `ECONNREFUSED`) from an unknown thrown value, if present.
 */
export function extractErrorCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}

/** Whether the error is a Node.js socket-level connection failure. */
export function isNodeConnectionError(error: unknown): boolean {
  const code = extractErrorCode(error);
  return code !== undefined && NODE_CONNECTION_ERROR_CODES.has(code);
}
