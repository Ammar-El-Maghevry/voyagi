/**
 * Small, dependency-free parsing helpers used by the typed configuration
 * factories. Environment variables always arrive as strings (or `undefined`),
 * so coercion is centralized here to avoid scattered, inconsistent parsing.
 */

/** Parse an integer, falling back to `fallback` when unset or not a number. */
export function parseInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Parse a boolean from common truthy/falsy string spellings. */
export function parseBoolean(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

/** Parse a comma-separated list into a trimmed, non-empty string array. */
export function parseList(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
