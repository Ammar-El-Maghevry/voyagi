/**
 * Stable, machine-readable error codes returned to API clients.
 *
 * These are part of the public API contract (see
 * `architecture/14-api-design-standards.md`) and must remain stable.
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  FORBIDDEN = 'FORBIDDEN',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  CONFLICT = 'CONFLICT',
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  DEPENDENCY_FAILURE = 'DEPENDENCY_FAILURE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
