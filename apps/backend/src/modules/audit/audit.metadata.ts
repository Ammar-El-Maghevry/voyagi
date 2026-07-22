import type { AuditJsonObject, AuditJsonValue } from './audit.types';

/**
 * Public, intentionally small metadata vocabulary. Values are structural state
 * changes, not request payloads or personally identifying information.
 */
export const AUDIT_SAFE_METADATA_KEYS = new Set([
  'status',
  'previousStatus',
  'nextStatus',
  'isActive',
  'active',
  'currency',
  'amount',
  'amountMru',
  'reasonCode',
  'reference',
  'branchId',
  'routeId',
  'tripId',
  'bookingId',
  'paymentId',
  'ticketId',
  'maintenanceId',
  'commissionId',
  'eventType',
  'changeType',
  'result',
  'changes',
  'fields',
]);

const MAX_DEPTH = 8;

/**
 * Produce metadata that is safe to persist and return. Only JSON objects are
 * accepted at the root; unapproved and sensitive keys are removed at every
 * depth, including objects nested inside arrays.
 */
export function sanitizeAuditMetadata(value: unknown): AuditJsonObject | null {
  if (!isPlainObject(value)) {
    return null;
  }
  return sanitizeObject(value, 0, new WeakSet<object>());
}

function sanitizeObject(
  value: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>,
): AuditJsonObject {
  if (depth >= MAX_DEPTH || seen.has(value)) {
    return {};
  }
  seen.add(value);

  const result: Record<string, AuditJsonValue> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!AUDIT_SAFE_METADATA_KEYS.has(key) || isSensitiveAuditKey(key)) {
      continue;
    }
    const sanitized = sanitizeValue(candidate, depth + 1, seen);
    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }
  seen.delete(value);
  return result;
}

function isSensitiveAuditKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (
    normalized.includes('password') ||
    normalized.includes('token') ||
    normalized.includes('auth') ||
    normalized.includes('cookie') ||
    normalized.includes('webhook') ||
    normalized.includes('idempotency') ||
    normalized.includes('qr') ||
    normalized.includes('card') ||
    normalized.includes('cvv') ||
    normalized.includes('document') ||
    normalized.includes('phone') ||
    normalized.includes('passenger') ||
    normalized.includes('useragent') ||
    normalized.includes('device') ||
    normalized.includes('operatingsystem') ||
    normalized.includes('browser') ||
    normalized === 'ip' ||
    normalized.includes('ipaddress')
  ) {
    return true;
  }
  return normalized.includes('provider') && normalized.includes('secret');
}

function sanitizeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): AuditJsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (depth >= MAX_DEPTH) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const items: AuditJsonValue[] = [];
    for (const item of value) {
      const sanitized = sanitizeValue(item, depth + 1, seen);
      if (sanitized !== undefined) {
        items.push(sanitized);
      }
    }
    return items;
  }
  return isPlainObject(value) ? sanitizeObject(value, depth, seen) : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
