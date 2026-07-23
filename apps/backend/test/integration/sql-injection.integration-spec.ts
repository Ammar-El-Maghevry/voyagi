import { Pool, type PoolClient } from 'pg';
import { attemptWrite } from '../support/factories/rls-session';
import { seedTenantGraph, TENANT } from '../support/factories/tenant-graph';
import { SQL_INJECTION_STRINGS } from '../support/factories/abuse-cases';

/**
 * SQL-injection integration matrix against the real local PostgreSQL database.
 * It routes classic injection payloads through the SAME parameterized query
 * shapes the repositories use (search filters, reference lookups, id casts,
 * tenant-scoped lists) and proves that every payload is treated as opaque data:
 *
 *  - SQL structure is unchanged (a sentinel row-count is identical afterwards);
 *  - parameters never alter the query (scoped/reference lookups return no rows);
 *  - no cross-tenant data leaks (a company-A-scoped query never returns B);
 *  - an id cast rejects non-UUID input with a typed 22P02, leaking no structure.
 *
 * Everything runs on one pinned connection inside a transaction that is rolled
 * back; nothing is committed.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('SQL-injection integration matrix', () => {
  let pool: Pool;
  let client: PoolClient;
  let available = false;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    pool.on('error', () => undefined);
    try {
      client = await pool.connect();
      await client.query('SELECT 1');
      available = true;
    } catch {
      available = false;
      console.warn(
        `[integration] No database reachable at ${DATABASE_URL} — skipping SQL-injection matrix.`,
      );
      return;
    }
    await client.query('BEGIN');
    await seedTenantGraph(client);
  });

  afterAll(async () => {
    try {
      if (client) {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    } finally {
      await pool.end();
    }
  });

  async function sentinelCounts(): Promise<Record<string, number>> {
    const { rows } = await client.query<{
      companies: string;
      bookings: string;
      payments: string;
      audit_logs: string;
    }>(
      `select
         (select count(*) from public.companies)::text as companies,
         (select count(*) from public.bookings)::text as bookings,
         (select count(*) from public.payments)::text as payments,
         (select count(*) from public.audit_logs)::text as audit_logs`,
    );
    return {
      companies: Number(rows[0].companies),
      bookings: Number(rows[0].bookings),
      payments: Number(rows[0].payments),
      audit_logs: Number(rows[0].audit_logs),
    };
  }

  it('leaves table structure and contents unchanged after the full payload sweep', async () => {
    if (!available) return;
    const before = await sentinelCounts();

    for (const { value } of SQL_INJECTION_STRINGS) {
      // Search filter (city/station/route search shape).
      const search = await client.query(
        `select count(*)::text as c from public.stations
          where name_fr ilike '%' || $1 || '%' or name_ar ilike '%' || $1 || '%'`,
        [value],
      );
      expect(Number(search.rows[0].c)).toBe(0);

      // Reference lookups (booking / payment reference shape).
      const ref = await client.query(
        `select count(*)::text as c from public.bookings where booking_reference = $1`,
        [value],
      );
      expect(Number(ref.rows[0].c)).toBe(0);

      const payRef = await client.query(
        `select count(*)::text as c from public.payments where internal_reference = $1`,
        [value],
      );
      expect(Number(payRef.rows[0].c)).toBe(0);
    }

    const after = await sentinelCounts();
    expect(after).toEqual(before);
  });

  it('keeps a tenant-scoped query scoped — injection never returns company B', async () => {
    if (!available) return;
    for (const { value } of SQL_INJECTION_STRINGS) {
      // Company-A-scoped listing shape with a hostile secondary filter value.
      const { rows } = await client.query<{ company_id: string }>(
        `select company_id::text as company_id from public.bookings
          where company_id = $1 and booking_reference <> $2`,
        [TENANT.companies.a, value],
      );
      // Only tenant-A rows, never tenant-B, regardless of the payload.
      expect(
        rows.every((r) => r.company_id === String(TENANT.companies.a)),
      ).toBe(true);
      expect(
        rows.some((r) => r.company_id === String(TENANT.companies.b)),
      ).toBe(false);
    }
  });

  it('rejects a non-UUID id cast with a typed 22P02 and no structural effect', async () => {
    if (!available) return;
    const before = await sentinelCounts();
    for (const { value } of SQL_INJECTION_STRINGS) {
      const attempt = await attemptWrite(
        client,
        `select * from public.bookings where id = $1::uuid`,
        [value],
      );
      // Invalid text representation — a safe, typed rejection, not execution.
      expect(attempt.code).toBe('22P02');
    }
    const after = await sentinelCounts();
    expect(after).toEqual(before);
  });

  it('treats an injection payload as a literal booking reference (parameter stays data)', async () => {
    if (!available) return;
    // Insert a booking whose reference literally equals an injection string, then
    // prove it is retrievable ONLY by exact parameterized match — the payload
    // never executed, it was stored and compared as plain text.
    const literal = "'; DROP TABLE public.bookings; --";
    await client.query(
      `insert into public.bookings (booking_reference, trip_id, company_id, branch_id,
         booked_by_user_id, booking_channel, status, subtotal_amount, total_amount, idempotency_key)
       values ($1, $2, $3, $4, $5, 'AGENT', 'CONFIRMED', 100, 100, 'inj-literal')`,
      [
        literal,
        TENANT.trips.a,
        TENANT.companies.a,
        TENANT.branches.a1,
        TENANT.users.agentA,
      ],
    );
    const { rows } = await client.query<{ c: string }>(
      `select count(*)::text as c from public.bookings where booking_reference = $1`,
      [literal],
    );
    expect(Number(rows[0].c)).toBe(1);
    // The table still exists and DROP never ran.
    const exists = await client.query<{ ok: boolean }>(
      `select to_regclass('public.bookings') is not null as ok`,
    );
    expect(exists.rows[0].ok).toBe(true);
  });
});
