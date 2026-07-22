/**
 * Validators for the database identifier shapes used by the identity domain.
 *
 * They exist to keep malformed identifiers from ever reaching a parameterized
 * query: PostgreSQL would reject a non-UUID `uuid` value or a non-numeric
 * `bigint` value with SQLSTATE 22P02, which the error mapper surfaces as an
 * unexpected 500. Validating first lets the caller fail closed (no profile / no
 * membership → 403 or 404) instead of leaking a dependency error.
 */

/** Canonical 8-4-4-4-12 hex UUID, any version. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Positive integer with no leading zeros. */
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

/** Largest value a PostgreSQL `bigint` can hold. */
const MAX_BIGINT = 9223372036854775807n;

/** Whether `value` is a syntactically valid UUID (e.g. a Supabase auth user id). */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Parse a client-supplied `bigint` surrogate key (company id, membership id).
 * Returns the normalized string when it is a positive integer within `bigint`
 * range, otherwise `null`. The value is kept as a string because JavaScript
 * numbers cannot represent the full 64-bit range precisely.
 */
export function parsePositiveBigInt(value: string): string | null {
  if (!POSITIVE_INTEGER_PATTERN.test(value)) {
    return null;
  }
  if (BigInt(value) > MAX_BIGINT) {
    return null;
  }
  return value;
}
