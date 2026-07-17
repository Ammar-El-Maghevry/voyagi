import type { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DatabaseErrorMapper } from '../../src/infrastructure/database/database-error.mapper';
import { DatabaseReadinessIndicator } from '../../src/infrastructure/database/database-readiness.indicator';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { TransactionManager } from '../../src/infrastructure/database/transaction.manager';

/**
 * Integration tests against a real PostgreSQL instance (the local Supabase
 * stack by default). They are non-destructive: all writes go to a
 * session-scoped TEMP table on a single pinned connection (pool max = 1), which
 * PostgreSQL drops automatically when the pool closes. No real schema or data
 * is touched, and nothing is left behind.
 *
 * When no database is reachable, the suite skips its assertions so the command
 * stays deterministic in environments without a database.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const fakeConfig = {
  get: () => ({
    logQueries: false,
    slowQueryMs: 1_000,
    readinessTimeoutMs: 2_000,
  }),
} as unknown as ConfigService;

describe('Database infrastructure (integration)', () => {
  let pool: Pool;
  let database: DatabaseService;
  let transactions: TransactionManager;
  let available = false;

  beforeAll(async () => {
    // Single pinned connection so a session TEMP table is visible across calls.
    pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    pool.on('error', () => undefined);

    const mapper = new DatabaseErrorMapper();
    database = new DatabaseService(pool, mapper, fakeConfig);
    transactions = new TransactionManager(pool, mapper);

    try {
      await pool.query('SELECT 1');
      available = true;
    } catch {
      available = false;
      console.warn(
        `[integration] No database reachable at ${DATABASE_URL} — skipping assertions.`,
      );
    }
  });

  afterAll(async () => {
    // Closing the session drops the TEMP table; no residue remains.
    await pool.end();
  });

  it('executes a real parameterized query', async () => {
    if (!available) return;
    const result = await database.query<{ n: number }>(
      'SELECT $1::int AS n',
      [42],
    );
    expect(result.rows[0].n).toBe(42);
  });

  it('commits a transaction durably (within the session)', async () => {
    if (!available) return;
    await transactions.run(async (tx) => {
      await tx.query('CREATE TEMP TABLE IF NOT EXISTS tx_probe (val text)');
      await tx.query('INSERT INTO tx_probe (val) VALUES ($1)', ['committed']);
    });

    const count = await database.query<{ c: string }>(
      "SELECT count(*)::text AS c FROM tx_probe WHERE val = 'committed'",
    );
    expect(count.rows[0].c).toBe('1');
  });

  it('rolls back a failed transaction, discarding its writes', async () => {
    if (!available) return;
    await expect(
      transactions.run(async (tx) => {
        await tx.query('CREATE TEMP TABLE IF NOT EXISTS tx_probe (val text)');
        await tx.query('INSERT INTO tx_probe (val) VALUES ($1)', ['rolledback']);
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    const count = await database.query<{ c: string }>(
      "SELECT count(*)::text AS c FROM tx_probe WHERE val = 'rolledback'",
    );
    expect(count.rows[0].c).toBe('0');
  });

  it('surfaces real unique-constraint violations as typed errors', async () => {
    if (!available) return;
    await transactions.run(async (tx) => {
      await tx.query(
        'CREATE TEMP TABLE IF NOT EXISTS uniq_probe (id int primary key)',
      );
    });
    await database.query('INSERT INTO uniq_probe (id) VALUES (1)');

    await expect(
      database.query('INSERT INTO uniq_probe (id) VALUES (1)'),
    ).rejects.toMatchObject({ dbErrorCode: 'UNIQUE_VIOLATION' });
  });

  it('exposes pool statistics', async () => {
    if (!available) return;
    await database.query('SELECT 1');
    const stats = database.getPoolStats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(typeof stats.idle).toBe('number');
    expect(typeof stats.waiting).toBe('number');
  });

  it('reports readiness up against the real database', async () => {
    if (!available) return;
    const indicator = new DatabaseReadinessIndicator(database, fakeConfig);
    await expect(indicator.check()).resolves.toEqual({ status: 'up' });
  });
});

/**
 * Readiness against a genuinely unreachable database. Uses a closed local port
 * so the connection is really refused (no mocks) — deterministic in any
 * environment and independent of whether the local stack is running.
 */
describe('Database readiness when unreachable (integration)', () => {
  const unreachableConfig = {
    get: () => ({ readinessTimeoutMs: 1_000 }),
  } as unknown as ConfigService;

  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString:
        'postgresql://postgres:postgres@127.0.0.1:59999/postgres',
      max: 1,
      connectionTimeoutMillis: 800,
    });
    pool.on('error', () => undefined);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('reports down without leaking connection details', async () => {
    const database = new DatabaseService(
      pool,
      new DatabaseErrorMapper(),
      unreachableConfig,
    );
    const indicator = new DatabaseReadinessIndicator(database, unreachableConfig);

    const result = await indicator.check();
    expect(result.status).toBe('down');
    expect(JSON.stringify(result)).not.toContain('59999');
  });
});
