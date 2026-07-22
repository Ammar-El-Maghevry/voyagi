import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { resolvePagination } from '../../src/common/pagination/pagination';
import { DatabaseErrorMapper } from '../../src/infrastructure/database/database-error.mapper';
import {
  Transaction,
  TransactionManager,
} from '../../src/infrastructure/database/transaction.manager';
import { BranchesService } from '../../src/modules/branches/branches.service';
import { PostgresBranchesRepository } from '../../src/modules/branches/postgres-branches.repository';
import {
  BranchNotFoundError,
  BranchStateConflictError,
} from '../../src/modules/branches/branch.errors';
import { IdentityService } from '../../src/modules/identity/identity.service';
import { PostgresIdentityRepository } from '../../src/modules/identity/postgres-identity.repository';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

interface Seed {
  userManager: string;
  userEmployee: string;
  companyA: string;
  companyB: string;
  cityId: string;
  branchA1: string;
  branchA2: string;
  branchB1: string;
}

describe('Branches domain (integration)', () => {
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
      console.warn(`[integration] No database at ${DATABASE_URL} — skipping branches assertions.`);
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
    const userManager = randomUUID();
    const userEmployee = randomUUID();
    await tx.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4)`, [
      userManager,
      `${userManager}@itest.local`,
      userEmployee,
      `${userEmployee}@itest.local`,
    ]);

    const suffix = userManager.slice(0, 8);
    const companyA = await scalar(tx, `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`, [`BItestA-${suffix}`]);
    const companyB = await scalar(tx, `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`, [`BItestB-${suffix}`]);
    const cityId = await scalar(tx, `INSERT INTO public.cities (name_ar, name_fr) VALUES ($1,$2) RETURNING id`, [`مدينة-${suffix}`, `Ville-${suffix}`]);
    const branchA1 = await scalar(tx, `INSERT INTO public.branches (company_id, city_id, name_ar, name_fr) VALUES ($1,$2,$3,$4) RETURNING id`, [companyA, cityId, `فرعA1-${suffix}`, `AgenceA1-${suffix}`]);
    const branchA2 = await scalar(tx, `INSERT INTO public.branches (company_id, city_id, name_ar, name_fr) VALUES ($1,$2,$3,$4) RETURNING id`, [companyA, cityId, `فرعA2-${suffix}`, `AgenceA2-${suffix}`]);
    const branchB1 = await scalar(tx, `INSERT INTO public.branches (company_id, city_id, name_ar, name_fr) VALUES ($1,$2,$3,$4) RETURNING id`, [companyB, cityId, `فرعB1-${suffix}`, `AgenceB1-${suffix}`]);

    await tx.query(`INSERT INTO public.company_memberships (user_id, company_id, role) VALUES ($1,$2,'COMPANY_MANAGER')`, [userManager, companyA]);
    await tx.query(`INSERT INTO public.company_memberships (user_id, company_id, branch_id, role) VALUES ($1,$2,$3,'BRANCH_EMPLOYEE')`, [userEmployee, companyA, branchA1]);

    return { userManager, userEmployee, companyA, companyB, cityId, branchA1, branchA2, branchB1 };
  }

  function build(tx: Transaction): BranchesService {
    return new BranchesService(
      new PostgresBranchesRepository(tx),
      new IdentityService(new PostgresIdentityRepository(tx)),
    );
  }

  it('lists all company branches for a company-wide manager', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const page = await build(tx).listBranches(s.userManager, s.companyA, resolvePagination());
      const ids = page.items.map((b) => b.id);
      expect(ids).toEqual(expect.arrayContaining([s.branchA1, s.branchA2]));
      expect(ids).not.toContain(s.branchB1);
      // Count isolation: only company A branches are counted.
      expect(page.total).toBe(2);
    });
  });

  it('restricts a branch employee to their own branch (read visibility)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const service = build(tx);

      const page = await service.listBranches(s.userEmployee, s.companyA, resolvePagination());
      expect(page.items.map((b) => b.id)).toEqual([s.branchA1]);

      await expect(service.getBranch(s.userEmployee, s.companyA, s.branchA1)).resolves.toMatchObject({ id: s.branchA1 });
      // Sibling branch in the same company is not visible to the employee.
      await expect(service.getBranch(s.userEmployee, s.companyA, s.branchA2)).rejects.toBeInstanceOf(BranchNotFoundError);
    });
  });

  it('does not find a branch id addressed under the wrong company (tenant isolation)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      await expect(build(tx).getBranch(s.userManager, s.companyA, s.branchB1)).rejects.toBeInstanceOf(BranchNotFoundError);
    });
  });

  it('creates a branch and rejects a duplicate name (unique constraint → conflict)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const service = build(tx);
      const created = await service.createBranch(s.companyA, { cityId: s.cityId, nameAr: 'جديد', nameFr: 'Nouveau' });
      expect(created.companyId).toBe(s.companyA);

      await expect(
        service.createBranch(s.companyA, { cityId: s.cityId, nameAr: 'جديد', nameFr: 'Nouveau' }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  it('rejects a create referencing a non-existent city (foreign key)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      await expect(
        build(tx).createBranch(s.companyA, { cityId: '999999999', nameAr: 'x', nameFr: 'y' }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  it('updates a branch and 404s an update in another company', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const service = build(tx);
      const updated = await service.updateBranch(s.companyA, s.branchA1, { nameFr: 'Renamed' });
      expect(updated.nameFr).toBe('Renamed');
      await expect(service.updateBranch(s.companyA, s.branchB1, { nameFr: 'x' })).rejects.toBeInstanceOf(BranchNotFoundError);
    });
  });

  it('transitions activation and conflicts on a redundant transition', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const service = build(tx);
      const off = await service.setBranchActive(s.companyA, s.branchA1, false);
      expect(off.isActive).toBe(false);
      await expect(service.setBranchActive(s.companyA, s.branchA1, false)).rejects.toBeInstanceOf(BranchStateConflictError);
      const on = await service.setBranchActive(s.companyA, s.branchA1, true);
      expect(on.isActive).toBe(true);
    });
  });

  it('enforces branch-level visibility at the database layer via RLS', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);

      // As the employee: RLS branches_tenant_read = has_branch_access → only their branch.
      await tx.query(`SET LOCAL role authenticated`);
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: s.userEmployee, role: 'authenticated' }),
      ]);
      const employeeView = await tx.query<{ id: string }>(
        `SELECT id FROM public.branches WHERE company_id = $1`,
        [s.companyA],
      );
      expect(employeeView.rows.map((r) => r.id)).toEqual([s.branchA1]);
      await tx.query(`RESET role`);

      // As the manager: company-wide → sees every company A branch.
      await tx.query(`SET LOCAL role authenticated`);
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: s.userManager, role: 'authenticated' }),
      ]);
      const managerView = await tx.query<{ id: string }>(
        `SELECT id FROM public.branches WHERE company_id = $1 ORDER BY id`,
        [s.companyA],
      );
      expect(managerView.rows.map((r) => r.id)).toEqual(
        [s.branchA1, s.branchA2].sort((a, b) => Number(a) - Number(b)),
      );
      await tx.query(`RESET role`);
    });
  });
});
