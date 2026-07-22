import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { resolvePagination } from '../../src/common/pagination/pagination';
import { DatabaseErrorMapper } from '../../src/infrastructure/database/database-error.mapper';
import {
  Transaction,
  TransactionManager,
} from '../../src/infrastructure/database/transaction.manager';
import { BusesService } from '../../src/modules/buses/buses.service';
import { PostgresBusesRepository } from '../../src/modules/buses/postgres-buses.repository';
import {
  BusNotFoundError,
  BusStateConflictError,
} from '../../src/modules/buses/bus.errors';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

interface Seed {
  userMember: string;
  userOutsider: string;
  companyA: string;
  companyB: string;
  seatLayout: string;
  busA1: string;
  busA2: string;
  busB1: string;
}

describe('Buses domain (integration)', () => {
  let pool: Pool;
  let transactions: TransactionManager;
  let available = false;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    pool.on('error', () => undefined);
    try {
      await pool.query('SELECT 1');
      available = true;
    } catch {
      available = false;
      console.warn(`[integration] No database at ${DATABASE_URL} — skipping buses assertions.`);
    }
    transactions = new TransactionManager(pool, new DatabaseErrorMapper());
  });

  afterAll(async () => {
    await pool.end();
  });

  async function inRollback(work: (tx: Transaction) => Promise<void>): Promise<void> {
    const sentinel = new Error('rollback-sentinel');
    try {
      await transactions.run(async (tx) => {
        await work(tx);
        throw sentinel;
      });
    } catch (error) {
      if (error !== sentinel) throw error;
    }
  }

  async function scalar(tx: Transaction, text: string, params: readonly unknown[]): Promise<string> {
    const result = await tx.query<{ id: string }>(text, params);
    return String(result.rows[0].id);
  }

  async function seed(tx: Transaction): Promise<Seed> {
    const userMember = randomUUID();
    const userOutsider = randomUUID();
    await tx.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4)`, [
      userMember,
      `${userMember}@itest.local`,
      userOutsider,
      `${userOutsider}@itest.local`,
    ]);

    const suffix = userMember.slice(0, 8);
    const companyA = await scalar(tx, `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`, [`BusA-${suffix}`]);
    const companyB = await scalar(tx, `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`, [`BusB-${suffix}`]);
    const seatLayout = await scalar(
      tx,
      `INSERT INTO public.seat_layouts (name, total_seats, layout_grid) VALUES ($1, 2, '["1","2"]'::jsonb) RETURNING id`,
      [`Layout-${suffix}`],
    );
    const busA1 = await scalar(tx, `INSERT INTO public.buses (company_id, seat_layout_id, plate_number) VALUES ($1,$2,$3) RETURNING id`, [companyA, seatLayout, `A1-${suffix}`]);
    const busA2 = await scalar(tx, `INSERT INTO public.buses (company_id, seat_layout_id, plate_number) VALUES ($1,$2,$3) RETURNING id`, [companyA, seatLayout, `A2-${suffix}`]);
    const busB1 = await scalar(tx, `INSERT INTO public.buses (company_id, seat_layout_id, plate_number) VALUES ($1,$2,$3) RETURNING id`, [companyB, seatLayout, `B1-${suffix}`]);

    await tx.query(`INSERT INTO public.company_memberships (user_id, company_id, role) VALUES ($1,$2,'COMPANY_MANAGER')`, [userMember, companyA]);
    await tx.query(`INSERT INTO public.company_memberships (user_id, company_id, role) VALUES ($1,$2,'COMPANY_MANAGER')`, [userOutsider, companyB]);

    return { userMember, userOutsider, companyA, companyB, seatLayout, busA1, busA2, busB1 };
  }

  function build(tx: Transaction): BusesService {
    return new BusesService(new PostgresBusesRepository(tx));
  }

  it('lists only the company its buses and counts in isolation', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const page = await build(tx).listBuses(s.companyA, resolvePagination());
      const ids = page.items.map((b) => b.id);
      expect(ids).toEqual(expect.arrayContaining([s.busA1, s.busA2]));
      expect(ids).not.toContain(s.busB1);
      expect(page.total).toBe(2);
    });
  });

  it('does not find a bus id addressed under the wrong company (tenant isolation)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      await expect(build(tx).getBus(s.companyA, s.busB1)).rejects.toBeInstanceOf(BusNotFoundError);
    });
  });

  it('creates a bus and rejects a duplicate plate (unique constraint → 409)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const service = build(tx);
      const created = await service.createBus(s.companyA, { seatLayoutId: s.seatLayout, plateNumber: `NEW-${s.companyA}` });
      expect(created.companyId).toBe(s.companyA);
      expect(created.status).toBe('ACTIVE');

      await expect(
        service.createBus(s.companyA, { seatLayoutId: s.seatLayout, plateNumber: `NEW-${s.companyA}` }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  it('rejects a create referencing a non-existent seat layout (foreign key → 409)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      await expect(
        build(tx).createBus(s.companyA, { seatLayoutId: '999999999', plateNumber: `FK-${s.companyA}` }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  it('rejects a negative odometer at the database (check constraint → 422)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      await expect(
        build(tx).createBus(s.companyA, { seatLayoutId: s.seatLayout, plateNumber: `ODO-${s.companyA}`, currentOdometerKm: -1 }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  it('updates a bus (bumping version) and 404s an update in another company', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const service = build(tx);
      const updated = await service.updateBus(s.companyA, s.busA1, { currentOdometerKm: 4200 });
      expect(updated.currentOdometerKm).toBe(4200);
      expect(updated.version).toBe(2);
      await expect(service.updateBus(s.companyA, s.busB1, { currentOdometerKm: 1 })).rejects.toBeInstanceOf(BusNotFoundError);
    });
  });

  it('transitions activation and conflicts on a redundant transition', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const service = build(tx);
      const off = await service.setBusActive(s.companyA, s.busA1, false);
      expect(off.isActive).toBe(false);
      await expect(service.setBusActive(s.companyA, s.busA1, false)).rejects.toBeInstanceOf(BusStateConflictError);
      const on = await service.setBusActive(s.companyA, s.busA1, true);
      expect(on.isActive).toBe(true);
    });
  });

  it('enforces company-level visibility at the database layer via RLS', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);

      // As a company A member: buses_tenant_read = has_company_access → its buses.
      await tx.query(`SET LOCAL role authenticated`);
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: s.userMember, role: 'authenticated' }),
      ]);
      const memberView = await tx.query<{ id: string }>(
        `SELECT id FROM public.buses WHERE company_id = $1 ORDER BY id`,
        [s.companyA],
      );
      expect(memberView.rows.map((r) => r.id)).toEqual(
        [s.busA1, s.busA2].sort((a, b) => Number(a) - Number(b)),
      );
      await tx.query(`RESET role`);

      // As an outsider (member of company B only): no access to company A buses.
      await tx.query(`SET LOCAL role authenticated`);
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: s.userOutsider, role: 'authenticated' }),
      ]);
      const outsiderView = await tx.query<{ id: string }>(
        `SELECT id FROM public.buses WHERE company_id = $1`,
        [s.companyA],
      );
      expect(outsiderView.rows).toHaveLength(0);
      await tx.query(`RESET role`);
    });
  });
});
