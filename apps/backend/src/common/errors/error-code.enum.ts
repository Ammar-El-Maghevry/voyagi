/**
 * Stable, machine-readable error codes returned to API clients.
 *
 * These are part of the public API contract (see
 * `architecture/14-api-design-standards.md`) and must remain stable.
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  /** Access token verified but expired — clients should refresh. */
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  /**
   * Access token failed verification for any non-expiry reason. Fine-grained
   * cryptographic/claim failures deliberately collapse to this single code so
   * the API never acts as a token-verification oracle.
   */
  TOKEN_INVALID = 'TOKEN_INVALID',
  FORBIDDEN = 'FORBIDDEN',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  CONFLICT = 'CONFLICT',
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  DEPENDENCY_FAILURE = 'DEPENDENCY_FAILURE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
