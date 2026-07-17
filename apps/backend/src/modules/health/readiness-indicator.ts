/** Result of a single readiness check. */
export interface ReadinessResult {
  status: 'up' | 'down';
  detail?: string;
}

/**
 * A dependency readiness probe. Later phases (e.g. the database in Phase 2)
 * register implementations; the health module aggregates them without knowing
 * their concrete details (dependency inversion).
 */
export interface ReadinessIndicator {
  readonly name: string;
  check(): Promise<ReadinessResult>;
}

/** DI token for the (multi-provider) set of readiness indicators. */
export const READINESS_INDICATORS = Symbol('READINESS_INDICATORS');
