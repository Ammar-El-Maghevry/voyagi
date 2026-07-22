import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { resolvePagination } from '../../src/common/pagination/pagination';
import { DatabaseErrorMapper } from '../../src/infrastructure/database/database-error.mapper';
import {
  Transaction,
  TransactionManager,
} from '../../src/infrastructure/database/transaction.manager';
import { PostgresStaffRepository } from '../../src/modules/staff/postgres-staff.repository';
import {
  StaffMemberNotFoundError,
  StaffMemberStateConflictError,
} from '../../src/modules/staff/staff.errors';
import { StaffService } from '../../src/modules/staff/staff.service';
import { StaffType } from '../../src/modules/staff/staff-type';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

interface Seed {
  userMember: string;
  companyA: string;
  companyB: string;
  staffA1: string;
  staffA2: string;
  staffB1: string;
}

describe('Staff domain (integration)', () => {
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
      console.warn(`[integration] No database at ${DATABASE_URL} — skipping staff assertions.`);
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
    await tx.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, [
      userMember,
      `${userMember}@itest.local`,
    ]);
    const suffix = userMember.slice(0, 8);
    const companyA = await scalar(tx, `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`, [`SItestA-${suffix}`]);
    const companyB = await scalar(tx, `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`, [`SItestB-${suffix}`]);
    await tx.query(`INSERT INTO public.company_memberships (user_id, company_id, role) VALUES ($1,$2,'COMPANY_MANAGER')`, [userMember, companyA]);

    const staffA1 = await scalar(tx, `INSERT INTO public.staff_members (company_id, full_name, staff_type) VALUES ($1,$2,'DRIVER') RETURNING id`, [companyA, `Driver-${suffix}`]);
    const staffA2 = await scalar(tx, `INSERT INTO public.staff_members (company_id, full_name, staff_type) VALUES ($1,$2,'ASSISTANT') RETURNING id`, [companyA, `Assistant-${suffix}`]);
    const staffB1 = await scalar(tx, `INSERT INTO public.staff_members (company_id, full_name, staff_type) VALUES ($1,$2,'DRIVER') RETURNING id`, [companyB, `OtherDriver-${suffix}`]);

    return { userMember, companyA, companyB, staffA1, staffA2, staffB1 };
  }

  const build = (tx: Transaction): StaffService =>
    new StaffService(new PostgresStaffRepository(tx));

  it('lists only the company staff and isolates the count', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const page = await build(tx).listStaff(s.companyA, resolvePagination());
      const ids = page.items.map((m) => m.id);
      expect(ids).toEqual(expect.arrayContaining([s.staffA1, s.staffA2]));
      expect(ids).not.toContain(s.staffB1);
      expect(page.total).toBe(2);
    });
  });

  it('reads a staff member and 404s one from another company', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const service = build(tx);
      await expect(service.getStaffMember(s.companyA, s.staffA1)).resolves.toMatchObject({ id: s.staffA1 });
      await expect(service.getStaffMember(s.companyA, s.staffB1)).rejects.toBeInstanceOf(StaffMemberNotFoundError);
    });
  });

  it('creates, updates, and 404s an update in another company', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const service = build(tx);
      const created = await service.createStaffMember(s.companyA, { fullName: 'New', staffType: StaffType.Driver });
      expect(created.staffType).toBe(StaffType.Driver);
      const updated = await service.updateStaffMember(s.companyA, created.id, { staffType: StaffType.Assistant });
      expect(updated.staffType).toBe(StaffType.Assistant);
      await expect(service.updateStaffMember(s.companyA, s.staffB1, { fullName: 'x' })).rejects.toBeInstanceOf(StaffMemberNotFoundError);
    });
  });

  it('transitions activation and conflicts on a redundant transition', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const service = build(tx);
      const off = await service.setStaffMemberActive(s.companyA, s.staffA1, false);
      expect(off.isActive).toBe(false);
      await expect(service.setStaffMemberActive(s.companyA, s.staffA1, false)).rejects.toBeInstanceOf(StaffMemberStateConflictError);
    });
  });

  it('enforces company-scoped visibility at the database layer via RLS', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      // As a member of company A: staff_tenant_read = has_company_access → sees
      // all company A staff, never company B's.
      await tx.query(`SET LOCAL role authenticated`);
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: s.userMember, role: 'authenticated' }),
      ]);
      const view = await tx.query<{ company_id: string }>(`SELECT company_id FROM public.staff_members`);
      expect(view.rows.length).toBe(2);
      expect(view.rows.every((r) => r.company_id === s.companyA)).toBe(true);
      await tx.query(`RESET role`);
    });
  });
});
