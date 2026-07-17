import { randomUUID } from 'node:crypto';
import {
  REQUEST_ID_HEADER,
  REQUEST_ID_PATTERN,
} from '../constants/request.constants';

/** Minimal request shape needed to resolve a request id. */
interface RequestIdCarrier {
  id?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

/** Minimal response shape needed to advertise the request id. */
interface HeaderWritableResponse {
  setHeader(name: string, value: string): void;
}

/** Whether `value` is an acceptable request id token. */
export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

/** Read the resolved request id, or an empty string if none was attached. */
export function getRequestId(request: { id?: unknown }): string {
  return isValidRequestId(request.id) ? request.id : '';
}

/**
 * Resolve the request id for a request/response pair and make it observable:
 *
 * 1. reuse an already-attached valid id (idempotent across callers);
 * 2. otherwise accept a valid incoming `X-Request-Id` header;
 * 3. otherwise generate a new UUID.
 *
 * The resolved id is attached to the request and echoed in the response
 * header. This function is intentionally usable both as Express middleware and
 * as the logger's `genReqId`, so whichever runs first wins and the other
 * reuses the same value.
 */
export function ensureRequestId(
  request: RequestIdCarrier,
  response: HeaderWritableResponse,
): string {
  let id: string;

  if (isValidRequestId(request.id)) {
    id = request.id;
  } else {
    const headerValue = request.headers[REQUEST_ID_HEADER];
    const incoming = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    id = isValidRequestId(incoming) ? incoming : randomUUID();
  }

  request.id = id;
  response.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
