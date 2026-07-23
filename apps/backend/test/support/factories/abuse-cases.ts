/**
 * Typed catalogs of hostile inputs shared by the abuse / malformed-input and
 * SQL-injection matrices. These are pure data (no mutable global state); each
 * case carries a readable label so a failure names the exact vector. Control and
 * null bytes are constructed programmatically so the source file stays clean
 * text while the runtime values genuinely contain those bytes.
 */

const NUL = String.fromCharCode(0);
const CONTROL = String.fromCharCode(7, 8, 27); // BEL, BS, ESC

/** A single abuse payload case. */
export interface AbuseCase {
  readonly label: string;
  readonly value: unknown;
}

/**
 * Privileged / server-authoritative fields that must never be settable from a
 * request body. The global whitelist validation rejects every one of these as an
 * unknown property (they are not declared on any write DTO).
 */
export const PRIVILEGED_FIELDS: readonly string[] = [
  'id',
  'userId',
  'companyId',
  'branchId',
  'membershipId',
  'bookedByUserId',
  'status',
  'amount',
  'totalAmount',
  'subtotalAmount',
  'currency',
  'internalReference',
  'providerReference',
  'qrToken',
  'qrTokenHash',
  'requestFingerprint',
  'auditMetadata',
  'createdAt',
  'updatedAt',
  'paidAt',
  'issuedAt',
  'checkedInAt',
  'permissions',
  'roles',
  'role',
  'isActive',
  'commissionRate',
  'commissionAmount',
];

/** Malformed identifier values (for fields typed as positive bigint strings). */
export const MALFORMED_IDS: readonly AbuseCase[] = [
  { label: 'zero', value: '0' },
  { label: 'negative', value: '-1' },
  { label: 'huge-integer-string', value: '9'.repeat(40) },
  { label: 'decimal', value: '1.5' },
  { label: 'scientific-notation', value: '1e3' },
  { label: 'leading-zero', value: '01' },
  { label: 'empty', value: '' },
  { label: 'whitespace-only', value: '   ' },
  { label: 'hex', value: '0x1F' },
  { label: 'alpha', value: 'abc' },
  { label: 'null-byte', value: `1${NUL}2` },
  { label: 'unicode-digits', value: '１２３' },
  { label: 'plus-prefixed', value: '+1' },
];

/** Malformed UUID values (for fields typed as UUID). */
export const MALFORMED_UUIDS: readonly AbuseCase[] = [
  { label: 'too-short', value: '1234' },
  { label: 'wrong-shape', value: '11111111-1111-1111-1111-11111111111' },
  { label: 'non-hex', value: 'zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz' },
  { label: 'integer', value: '123' },
  { label: 'empty', value: '' },
  { label: 'sql-comment', value: "1'; --" },
  { label: 'braces', value: '{11111111-1111-4111-8111-111111111111}' },
];

/** Malformed primitive values covering enums, numbers, booleans and strings. */
export const MALFORMED_PRIMITIVES: readonly AbuseCase[] = [
  { label: 'invalid-enum', value: 'NOT_A_VALUE' },
  { label: 'boolean-as-string', value: 'true' },
  { label: 'nan-string', value: 'NaN' },
  { label: 'infinity-string', value: 'Infinity' },
  { label: 'negative-amount', value: -5 },
  { label: 'too-many-decimals', value: 1.23456 },
  { label: 'malformed-decimal', value: '1.2.3' },
  { label: 'malformed-date', value: 'not-a-date' },
  { label: 'control-characters', value: `a${CONTROL}b` },
  { label: 'null-byte', value: `a${NUL}b` },
  { label: 'oversized-string', value: 'x'.repeat(5000) },
  { label: 'unicode-normalization', value: 'é'.repeat(50) },
  { label: 'array-injection', value: ['1', '2'] },
  { label: 'object-injection', value: { $ne: null } },
];

/**
 * Classic SQL-injection strings routed through user-supplied inputs. Against
 * parameterized queries every one of these is treated as an opaque literal.
 */
export const SQL_INJECTION_STRINGS: readonly AbuseCase[] = [
  { label: 'or-1-1', value: "' OR '1'='1" },
  { label: 'drop-table', value: "'; DROP TABLE public.bookings; --" },
  { label: 'union-select', value: "' UNION SELECT * FROM public.payments --" },
  { label: 'comment-truncation', value: 'admin -- ' },
  {
    label: 'stacked-update',
    value: "1'; UPDATE public.companies SET name='x'; --",
  },
  {
    label: 'boolean-blind',
    value: "1' AND (SELECT 1 FROM public.audit_logs)=1 --",
  },
  { label: 'quote-escape', value: "'' OR 1=1 --" },
  { label: 'time-based', value: "1'; SELECT pg_sleep(5); --" },
  { label: 'encoded-quote', value: '1%27%20OR%201=1' },
];

/** Build a body with a single privileged field injected onto a valid base. */
export function withPrivilegedField(
  base: Record<string, unknown>,
  field: string,
  value: unknown = 'injected',
): Record<string, unknown> {
  return { ...base, [field]: value };
}
