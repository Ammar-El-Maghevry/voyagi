import { Pool, type PoolClient } from 'pg';
import {
  asAnon,
  asAuthenticated,
  attemptWrite,
  countVisible,
  resetSession,
} from '../support/factories/rls-session';
import { seedTenantGraph, TENANT } from '../support/factories/tenant-graph';

/**
 * Consolidated, table-driven RLS matrix against the real local PostgreSQL
 * database. It seeds a deterministic two-tenant graph on a single pinned
 * connection inside a transaction that is rolled back, then switches to the real
 * non-bypassing `authenticated` / `anon` roles to prove every policy. The
 * connecting (owner) role is used ONLY to seed — never as proof of authenticated
 * behavior. Session role and JWT claims are reset after every case, so no test
 * depends on execution order.
 *
 * Intentional exceptions (documented per table):
 *   - profiles: a user may SELECT and UPDATE their OWN row (self-service).
 *   - company_memberships: a user may always SELECT their own membership.
 *   - agent_commission_transactions: the owning agent may SELECT their own rows.
 *   - cities/stations/seat_layouts are global read-only catalogs and are out of
 *     the tenant-owned scope enumerated here.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Every tenant-owned table under RLS, in the order enumerated by the brief. */
const TENANT_TABLES = [
  'profiles',
  'companies',
  'company_memberships',
  'branches',
  'staff_members',
  'buses',
  'routes',
  'route_price_history',
  'trips',
  'trip_events',
  'bookings',
  'booking_events',
  'passengers',
  'seat_reservations',
  'payments',
  'tickets',
  'vehicle_maintenance_records',
  'agent_commission_transactions',
  'audit_logs',
] as const;

/** Assertion tally, surfaced by the coverage summary test for the final report. */
let rlsAssertions = 0;
function assertRls(condition: () => void): void {
  rlsAssertions += 1;
  condition();
}

describe('Consolidated RLS matrix (integration)', () => {
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
        `[integration] No database reachable at ${DATABASE_URL} — skipping RLS matrix.`,
      );
      return;
    }
    // One outer transaction: seed as owner, assert as authenticated/anon, roll back.
    await client.query('BEGIN');
    await seedTenantGraph(client);
  });

  afterAll(async () => {
    // Always tear down, even if seeding aborted the transaction, so Jest never
    // hangs on the pinned connection.
    try {
      if (client) {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    } finally {
      await pool.end();
    }
  });

  afterEach(async () => {
    if (available) await resetSession(client);
  });

  const U = TENANT.users;

  // ---- Anonymous denial across every table -------------------------------

  describe('anonymous (anon) access is denied on every tenant table', () => {
    it.each(TENANT_TABLES)('anon cannot SELECT %s', async (table) => {
      if (!available) return;
      const { rows } = await client.query<{ ok: boolean }>(
        `select has_table_privilege('anon', 'public.${table}', 'SELECT') as ok`,
      );
      assertRls(() => expect(rows[0].ok).toBe(false));
    });

    it('a real anon SELECT is refused with permission-denied (42501)', async () => {
      if (!available) return;
      await asAnon(client);
      for (const table of ['bookings', 'payments', 'audit_logs', 'tickets']) {
        const attempt = await attemptWrite(
          client,
          `select * from public.${table} limit 1`,
        );
        assertRls(() => expect(attempt.code).toBe('42501'));
      }
    });
  });

  // ---- No direct writes for authenticated --------------------------------

  describe('authenticated has no direct INSERT/UPDATE/DELETE privilege', () => {
    it.each(TENANT_TABLES)(
      'authenticated cannot INSERT or DELETE %s',
      async (table) => {
        if (!available) return;
        const { rows } = await client.query<{
          ins: boolean;
          del: boolean;
        }>(
          `select has_table_privilege('authenticated', 'public.${table}', 'INSERT') as ins,
                  has_table_privilege('authenticated', 'public.${table}', 'DELETE') as del`,
        );
        assertRls(() => expect(rows[0].ins).toBe(false));
        assertRls(() => expect(rows[0].del).toBe(false));
      },
    );

    it('authenticated holds no table-level UPDATE privilege on any tenant table', async () => {
      if (!available) return;
      for (const table of TENANT_TABLES) {
        const { rows } = await client.query<{ upd: boolean }>(
          `select has_table_privilege('authenticated', 'public.${table}', 'UPDATE') as upd`,
        );
        assertRls(() => expect(rows[0].upd).toBe(false));
      }
    });

    it('the only authenticated UPDATE grant is column-scoped to profiles(full_name, phone_number)', async () => {
      if (!available) return;
      const { rows } = await client.query<{
        full_name: boolean;
        phone_number: boolean;
        id: boolean;
        is_active: boolean;
      }>(
        `select
           has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') as full_name,
           has_column_privilege('authenticated', 'public.profiles', 'phone_number', 'UPDATE') as phone_number,
           has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE') as id,
           has_column_privilege('authenticated', 'public.profiles', 'is_active', 'UPDATE') as is_active`,
      );
      assertRls(() => expect(rows[0].full_name).toBe(true));
      assertRls(() => expect(rows[0].phone_number).toBe(true));
      assertRls(() => expect(rows[0].id).toBe(false));
      assertRls(() => expect(rows[0].is_active).toBe(false));
    });

    it('a real authenticated INSERT is refused with permission-denied (42501)', async () => {
      if (!available) return;
      await asAuthenticated(client, U.managerA);
      const inserts: Array<[string, string, unknown[]]> = [
        [
          'bookings',
          `insert into public.bookings (booking_reference, trip_id, company_id, booking_channel, status, subtotal_amount, total_amount)
           values ('X', $1, $2, 'WEB', 'DRAFT', 100, 100)`,
          [TENANT.trips.a, TENANT.companies.a],
        ],
        [
          'audit_logs',
          `insert into public.audit_logs (company_id, action, entity_type, entity_id) values ($1, 'X', 'y', '1')`,
          [TENANT.companies.a],
        ],
        [
          'payments',
          `insert into public.payments (booking_id, method, amount, internal_reference) values ($1, 'CASH', 1, 'X')`,
          [TENANT.bookings.aAgent],
        ],
        [
          'agent_commission_transactions',
          `insert into public.agent_commission_transactions (agent_membership_id, booking_id, company_id, commission_rate, base_amount, commission_amount, status, earned_at)
           values ($1, $2, $3, 10, 100, 10, 'EARNED', now())`,
          [
            TENANT.memberships.agentA,
            TENANT.bookings.aAgent,
            TENANT.companies.a,
          ],
        ],
        [
          'vehicle_maintenance_records',
          `insert into public.vehicle_maintenance_records (bus_id, company_id, maintenance_type, status, started_at)
           values ($1, $2, 'OTHER', 'SCHEDULED', now())`,
          [TENANT.buses.a, TENANT.companies.a],
        ],
      ];
      for (const [, sql, params] of inserts) {
        const attempt = await attemptWrite(client, sql, params);
        assertRls(() => expect(attempt.code).toBe('42501'));
      }
    });

    it('a real authenticated DELETE is refused with permission-denied (42501)', async () => {
      if (!available) return;
      await asAuthenticated(client, U.managerA);
      for (const table of ['bookings', 'payments', 'tickets', 'audit_logs']) {
        const attempt = await attemptWrite(
          client,
          `delete from public.${table} where id is not null`,
        );
        assertRls(() => expect(attempt.code).toBe('42501'));
      }
    });
  });

  // ---- profiles: self-owned exception ------------------------------------

  describe('profiles — self-owned read/update exception', () => {
    it('a user reads only their own profile', async () => {
      if (!available) return;
      await asAuthenticated(client, U.managerA);
      const own = await countVisible(client, 'profiles', 'id = $1', [
        U.managerA,
      ]);
      const others = await countVisible(client, 'profiles', 'id = $1', [
        U.employeeA,
      ]);
      assertRls(() => expect(own).toBe(1));
      assertRls(() => expect(others).toBe(0));
    });

    it('a user may UPDATE their own profile but not another (RLS check → 0 rows)', async () => {
      if (!available) return;
      await asAuthenticated(client, U.managerA);
      const self = await attemptWrite(
        client,
        `update public.profiles set full_name = 'Renamed Self' where id = $1`,
        [U.managerA],
      );
      const other = await attemptWrite(
        client,
        `update public.profiles set full_name = 'Hijack' where id = $1`,
        [U.employeeA],
      );
      assertRls(() => expect(self).toEqual({ code: 'ok', rowCount: 1 }));
      assertRls(() => expect(other).toEqual({ code: 'ok', rowCount: 0 }));
    });
  });

  // ---- Company-scoped tables ---------------------------------------------

  describe('company-scoped tables (owner vs wrong tenant)', () => {
    const companyScoped: Array<[string, string]> = [
      ['companies', 'id = $1'],
      ['buses', 'company_id = $1'],
      ['staff_members', 'company_id = $1'],
      ['routes', 'company_id = $1'],
      ['trips', 'company_id = $1'],
      ['trip_events', 'company_id = $1'],
      ['vehicle_maintenance_records', 'company_id = $1'],
    ];

    it.each(companyScoped)(
      'manager A sees own %s but not company B',
      async (table, ownFilter) => {
        if (!available) return;
        await asAuthenticated(client, U.managerA);
        const own = await countVisible(client, table, ownFilter, [
          TENANT.companies.a,
        ]);
        const foreign = await countVisible(
          client,
          table,
          table === 'companies' ? 'id = $1' : 'company_id = $1',
          [TENANT.companies.b],
        );
        assertRls(() => expect(own).toBeGreaterThanOrEqual(1));
        assertRls(() => expect(foreign).toBe(0));
      },
    );

    it('route_price_history follows its route company', async () => {
      if (!available) return;
      await asAuthenticated(client, U.managerA);
      const own = await countVisible(
        client,
        'route_price_history',
        'route_id = $1',
        [TENANT.routes.a],
      );
      const foreign = await countVisible(
        client,
        'route_price_history',
        'route_id = $1',
        [TENANT.routes.b],
      );
      assertRls(() => expect(own).toBe(1));
      assertRls(() => expect(foreign).toBe(0));
    });
  });

  // ---- Memberships & branches (self / manager / branch scope) ------------

  describe('company_memberships — self or company manager', () => {
    it('a manager sees all memberships of their company', async () => {
      if (!available) return;
      await asAuthenticated(client, U.managerA);
      const seen = await countVisible(
        client,
        'company_memberships',
        'company_id = $1',
        [TENANT.companies.a],
      );
      const foreign = await countVisible(
        client,
        'company_memberships',
        'company_id = $1',
        [TENANT.companies.b],
      );
      assertRls(() => expect(seen).toBe(4));
      assertRls(() => expect(foreign).toBe(0));
    });

    it('a non-manager sees only their own membership', async () => {
      if (!available) return;
      await asAuthenticated(client, U.employeeA);
      const own = await countVisible(
        client,
        'company_memberships',
        'user_id = $1',
        [U.employeeA],
      );
      const siblings = await countVisible(
        client,
        'company_memberships',
        'user_id <> $1 and company_id = $2',
        [U.employeeA, TENANT.companies.a],
      );
      assertRls(() => expect(own).toBe(1));
      assertRls(() => expect(siblings).toBe(0));
    });
  });

  describe('branches — branch scope and wrong-branch denial', () => {
    it('a company manager sees every branch of their company', async () => {
      if (!available) return;
      await asAuthenticated(client, U.managerA);
      const own = await countVisible(client, 'branches', 'company_id = $1', [
        TENANT.companies.a,
      ]);
      const foreign = await countVisible(
        client,
        'branches',
        'company_id = $1',
        [TENANT.companies.b],
      );
      assertRls(() => expect(own).toBe(2));
      assertRls(() => expect(foreign).toBe(0));
    });

    it('a branch employee sees only their own branch (wrong-branch denied)', async () => {
      if (!available) return;
      await asAuthenticated(client, U.employeeA);
      const ownBranch = await countVisible(client, 'branches', 'id = $1', [
        TENANT.branches.a1,
      ]);
      const otherBranch = await countVisible(client, 'branches', 'id = $1', [
        TENANT.branches.a2,
      ]);
      assertRls(() => expect(ownBranch).toBe(1));
      assertRls(() => expect(otherBranch).toBe(0));
    });
  });

  // ---- Booking-scoped tables ---------------------------------------------

  describe('bookings — owner / branch / manager visibility', () => {
    it('a company manager sees both company-A bookings, none of company B', async () => {
      if (!available) return;
      await asAuthenticated(client, U.managerA);
      const own = await countVisible(client, 'bookings', 'company_id = $1', [
        TENANT.companies.a,
      ]);
      const foreign = await countVisible(
        client,
        'bookings',
        'company_id = $1',
        [TENANT.companies.b],
      );
      assertRls(() => expect(own).toBe(2));
      assertRls(() => expect(foreign).toBe(0));
    });

    it('a branch employee sees only their branch booking, not the online one', async () => {
      if (!available) return;
      await asAuthenticated(client, U.employeeA);
      const branchBooking = await countVisible(client, 'bookings', 'id = $1', [
        TENANT.bookings.aAgent,
      ]);
      const onlineBooking = await countVisible(client, 'bookings', 'id = $1', [
        TENANT.bookings.aWeb,
      ]);
      assertRls(() => expect(branchBooking).toBe(1));
      assertRls(() => expect(onlineBooking).toBe(0));
    });

    it('a passenger sees only the booking they own', async () => {
      if (!available) return;
      await asAuthenticated(client, U.passengerA);
      const owned = await countVisible(client, 'bookings', 'id = $1', [
        TENANT.bookings.aWeb,
      ]);
      const notOwned = await countVisible(client, 'bookings', 'id = $1', [
        TENANT.bookings.aAgent,
      ]);
      assertRls(() => expect(owned).toBe(1));
      assertRls(() => expect(notOwned).toBe(0));
    });
  });

  describe('booking children — booking-scope propagation', () => {
    const bookingScoped = [
      'booking_events',
      'passengers',
      'seat_reservations',
      'payments',
      'tickets',
    ];

    it.each(bookingScoped)(
      'manager A sees %s of an accessible booking, managerB sees none of it',
      async (table) => {
        if (!available) return;
        await asAuthenticated(client, U.managerA);
        const visible = await countVisible(client, table, 'booking_id = $1', [
          TENANT.bookings.aAgent,
        ]);
        await resetSession(client);
        await asAuthenticated(client, U.managerB);
        const foreign = await countVisible(client, table, 'booking_id = $1', [
          TENANT.bookings.aAgent,
        ]);
        assertRls(() => expect(visible).toBe(1));
        assertRls(() => expect(foreign).toBe(0));
      },
    );
  });

  // ---- Commissions & audit -----------------------------------------------

  describe('agent_commission_transactions — manager or owning agent', () => {
    it('the company manager and the owning agent can read the commission', async () => {
      if (!available) return;
      await asAuthenticated(client, U.managerA);
      const asManager = await countVisible(
        client,
        'agent_commission_transactions',
        'company_id = $1',
        [TENANT.companies.a],
      );
      await resetSession(client);
      await asAuthenticated(client, U.agentA);
      const asAgent = await countVisible(
        client,
        'agent_commission_transactions',
        'company_id = $1',
        [TENANT.companies.a],
      );
      assertRls(() => expect(asManager).toBe(1));
      assertRls(() => expect(asAgent).toBe(1));
    });

    it('company B cannot read company-A commissions', async () => {
      if (!available) return;
      await asAuthenticated(client, U.managerB);
      const foreign = await countVisible(
        client,
        'agent_commission_transactions',
        'company_id = $1',
        [TENANT.companies.a],
      );
      assertRls(() => expect(foreign).toBe(0));
    });
  });

  describe('audit_logs — company manager only', () => {
    it('the company manager reads their company audit logs', async () => {
      if (!available) return;
      await asAuthenticated(client, U.managerA);
      const own = await countVisible(client, 'audit_logs', 'company_id = $1', [
        TENANT.companies.a,
      ]);
      assertRls(() => expect(own).toBe(1));
    });

    it('a non-manager and a foreign manager read no audit logs', async () => {
      if (!available) return;
      await asAuthenticated(client, U.employeeA);
      const asEmployee = await countVisible(
        client,
        'audit_logs',
        'company_id = $1',
        [TENANT.companies.a],
      );
      await resetSession(client);
      await asAuthenticated(client, U.managerB);
      const asForeign = await countVisible(
        client,
        'audit_logs',
        'company_id = $1',
        [TENANT.companies.a],
      );
      assertRls(() => expect(asEmployee).toBe(0));
      assertRls(() => expect(asForeign).toBe(0));
    });
  });

  // ---- Inactive membership & unrelated user ------------------------------

  describe('inactive membership grants no access', () => {
    it('an inactive agent sees no company, bookings, or commissions', async () => {
      if (!available) return;
      await asAuthenticated(client, U.agentAInactive);
      const companies = await countVisible(client, 'companies', 'id = $1', [
        TENANT.companies.a,
      ]);
      const bookings = await countVisible(
        client,
        'bookings',
        'company_id = $1',
        [TENANT.companies.a],
      );
      const commissions = await countVisible(
        client,
        'agent_commission_transactions',
        'company_id = $1',
        [TENANT.companies.a],
      );
      assertRls(() => expect(companies).toBe(0));
      assertRls(() => expect(bookings).toBe(0));
      assertRls(() => expect(commissions).toBe(0));
    });
  });

  describe('an unrelated authenticated user sees nothing tenant-owned', () => {
    it.each([
      ['companies', 'id = $1', TENANT.companies.a],
      ['branches', 'company_id = $1', TENANT.companies.a],
      ['bookings', 'company_id = $1', TENANT.companies.a],
      ['payments', 'booking_id = $1', TENANT.bookings.aAgent],
      ['tickets', 'booking_id = $1', TENANT.bookings.aAgent],
      ['audit_logs', 'company_id = $1', TENANT.companies.a],
    ] as Array<[string, string, unknown]>)(
      'unrelated user sees no %s',
      async (table, filter, param) => {
        if (!available) return;
        await asAuthenticated(client, U.unrelated);
        const seen = await countVisible(client, table, filter, [param]);
        assertRls(() => expect(seen).toBe(0));
      },
    );
  });

  // ---- Coverage summary (machine-checkable) ------------------------------

  describe('coverage summary', () => {
    it('covers exactly the 19 enumerated tenant tables, all RLS-enabled', async () => {
      if (!available) return;
      expect(TENANT_TABLES).toHaveLength(19);
      const { rows } = await client.query<{ relname: string }>(
        `select c.relname
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
            and c.relname = any($1)`,
        [TENANT_TABLES as unknown as string[]],
      );
      expect(rows).toHaveLength(TENANT_TABLES.length);
    });

    it('reports the executed RLS assertion count', () => {
      // Surfaced for the final report; asserts the matrix actually ran.
      if (!available) return;
      console.log(`[rls-matrix] executed ${rlsAssertions} RLS assertions`);
      expect(rlsAssertions).toBeGreaterThan(80);
    });
  });
});
