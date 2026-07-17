/** Header carrying the request correlation id, inbound and outbound. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Accepted shape for an incoming request id. Bounded and restricted to safe
 * characters to prevent header/log injection via a client-supplied value.
 */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
