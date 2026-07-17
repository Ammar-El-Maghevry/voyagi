/**
 * DI token for the shared PostgreSQL connection pool (`pg.Pool`).
 *
 * Consumers should depend on {@link DatabaseService} or
 * {@link TransactionManager} rather than the raw pool; the token is exported
 * for advanced infrastructure use and testing.
 */
export const DATABASE_POOL = Symbol('DATABASE_POOL');
