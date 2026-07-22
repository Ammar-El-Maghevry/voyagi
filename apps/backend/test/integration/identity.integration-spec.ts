import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { resolvePagination } from '../../src/common/pagination/pagination';
import { DatabaseErrorMapper } from '../../src/infrastructure/database/database-error.mapper';
import {
  Transaction,
  TransactionManager,
} from '../../src/infrastructure/database/transaction.manager';
import { IdentityService } from '../../src/modules/identity/identity.service';
import {
  canExercisePermissionInBranch,
  effectivePermissionsForBranch,
} from '../../src/modules/identity/entitlements';
import { MembershipRole } from '../../src/modules/identity/membership-role';
import { PostgresIdentityRepository } from '../../src/modules/identity/postgres-identity.repository';
import { Permission } from '../../src/modules/authorization/permission.enum';

/**
 * Integration tests for the identity domain against a real PostgreSQL instance
 * (the local Supabase stack by default). Every test seeds and asserts inside a
 * single transaction that is always rolled back, so no data persists. When no
 * database is reachable the assertions are skipped so the command stays
 * deterministic.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

interface Seed {
  userManager: string;
  userEmployee: string;
  userOutsider: string;
  companyA: string;
  companyB: string;
  branchA: string;
  branchA2: string;
  membershipManager: string;
  membershipEmployee: string;
  membershipInactive: string;
  membershipOutsiderInB: string;
}

describe('Identity domain (integration)', () => {
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
      console.warn(
        `[integration] No database reachable at ${DATABASE_URL} — skipping identity assertions.`,
      );
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  /** Run `work` inside a transaction that is always rolled back. */
  async function inRollback(
    work: (tx: Transaction) => Promise<void>,
  ): Promise<void> {
    const sentinel = new Error('rollback-sentinel');
    try {
      await transactions.run(async (tx) => {
        await work(tx);
        throw sentinel;
      });
    } catch (error) {
      if (error !== sentinel) {
        throw error;
      }
    }
  }

  beforeAll(() => {
    transactions = new TransactionManager(pool, new DatabaseErrorMapper());
  });

  async function seed(tx: Transaction): Promise<Seed> {
    const userManager = randomUUID();
    const userEmployee = randomUUID();
    const userOutsider = randomUUID();

    // Inserting auth.users fires the trigger that creates the profile row.
    await tx.query(
      `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4),($5,$6)`,
      [
        userManager,
        `${userManager}@itest.local`,
        userEmployee,
        `${userEmployee}@itest.local`,
        userOutsider,
        `${userOutsider}@itest.local`,
      ],
    );
    await tx.query(
      `UPDATE public.profiles SET full_name = CASE id
         WHEN $1 THEN 'Manager Mona'
         WHEN $2 THEN 'Employee Emma'
         WHEN $3 THEN 'Outsider Omar' END
       WHERE id IN ($1,$2,$3)`,
      [userManager, userEmployee, userOutsider],
    );

    const suffix = userManager.slice(0, 8);
    const companyA = await scalar(tx, `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`, [`ItestA-${suffix}`]);
    const companyB = await scalar(tx, `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`, [`ItestB-${suffix}`]);
    const cityId = await scalar(tx, `INSERT INTO public.cities (name_ar, name_fr) VALUES ($1,$2) RETURNING id`, [`مدينة-${suffix}`, `Ville-${suffix}`]);
    const branchA = await scalar(
      tx,
      `INSERT INTO public.branches (company_id, city_id, name_ar, name_fr) VALUES ($1,$2,$3,$4) RETURNING id`,
      [companyA, cityId, `فرع-${suffix}`, `Agence-${suffix}`],
    );
    const branchA2 = await scalar(
      tx,
      `INSERT INTO public.branches (company_id, city_id, name_ar, name_fr) VALUES ($1,$2,$3,$4) RETURNING id`,
      [companyA, cityId, `فرع2-${suffix}`, `Agence2-${suffix}`],
    );

    const membershipManager = await scalar(
      tx,
      `INSERT INTO public.company_memberships (user_id, company_id, role) VALUES ($1,$2,'COMPANY_MANAGER') RETURNING id`,
      [userManager, companyA],
    );
    const membershipEmployee = await scalar(
      tx,
      `INSERT INTO public.company_memberships (user_id, company_id, branch_id, role) VALUES ($1,$2,$3,'BRANCH_EMPLOYEE') RETURNING id`,
      [userEmployee, companyA, branchA],
    );
    const membershipInactive = await scalar(
      tx,
      `INSERT INTO public.company_memberships (user_id, company_id, branch_id, role, is_active) VALUES ($1,$2,$3,'AGENT',false) RETURNING id`,
      [userOutsider, companyA, branchA],
    );
    const membershipOutsiderInB = await scalar(
      tx,
      `INSERT INTO public.company_memberships (user_id, company_id, role) VALUES ($1,$2,'COMPANY_MANAGER') RETURNING id`,
      [userOutsider, companyB],
    );

    return {
      userManager,
      userEmployee,
      userOutsider,
      companyA,
      companyB,
      branchA,
      branchA2,
      membershipManager,
      membershipEmployee,
      membershipInactive,
      membershipOutsiderInB,
    };
  }

  function build(tx: Transaction): IdentityService {
    return new IdentityService(new PostgresIdentityRepository(tx));
  }

  it('looks up a profile and updates it', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const service = build(tx);

      const profile = await service.getProfile(s.userManager);
      expect(profile.fullName).toBe('Manager Mona');

      const updated = await service.updateProfile(s.userManager, {
        fullName: 'Manager Mira',
      });
      expect(updated.fullName).toBe('Manager Mira');
    });
  });

  it('resolves a manager context with full permissions and company-wide branch access', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const context = await build(tx).resolveMembershipContext(
        s.userManager,
        s.companyA,
      );

      expect(context).not.toBeNull();
      expect(context?.memberships.map((m) => m.id)).toEqual([s.membershipManager]);
      expect(context?.permissions).toContain(Permission.MembershipsRead);
      expect(context?.branchAccess).toEqual({ kind: 'company-wide' });
    });
  });

  it('resolves an employee context: read set only, restricted to their branch', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const context = await build(tx).resolveMembershipContext(
        s.userEmployee,
        s.companyA,
      );

      expect(context?.memberships[0].role).toBe(MembershipRole.BranchEmployee);
      // Read set is granted; undocumented writes are not (fail closed).
      expect(context?.permissions).toContain(Permission.TripsRead);
      expect(context?.permissions).not.toContain(Permission.TicketsIssue);
      expect(context?.permissions).not.toContain(Permission.BookingsCreate);
      expect(context?.permissions).not.toContain(Permission.MembershipsRead);
      // Branch isolation: access is limited to their own branch, not company-wide.
      expect(context?.branchAccess).toEqual({
        kind: 'restricted',
        branchIds: [s.branchA],
      });
    });
  });

  it('unions permissions and branches across several same-company memberships', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      // Give the employee a second, agent membership at another branch.
      await tx.query(
        `INSERT INTO public.company_memberships (user_id, company_id, branch_id, role) VALUES ($1,$2,$3,'AGENT')`,
        [s.userEmployee, s.companyA, s.branchA2],
      );

      const context = await build(tx).resolveMembershipContext(
        s.userEmployee,
        s.companyA,
      );

      expect(context?.memberships).toHaveLength(2);
      // Union: read set (employee+agent) plus the agent's bookings.create only.
      expect(context?.permissions).toContain(Permission.BookingsCreate);
      expect(context?.permissions).not.toContain(Permission.MembershipsRead);
      // Branch access is the union of both branches.
      expect(context?.branchAccess.kind).toBe('restricted');
      const branchIds =
        context?.branchAccess.kind === 'restricted'
          ? [...context.branchAccess.branchIds].sort()
          : [];
      expect(branchIds).toEqual([s.branchA, s.branchA2].sort());
    });
  });

  it('does not let one membership’s permission cross into another’s branch', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      // Employee at branch A (read set, no create) + agent at branch A2 (create).
      await tx.query(
        `INSERT INTO public.company_memberships (user_id, company_id, branch_id, role) VALUES ($1,$2,$3,'AGENT')`,
        [s.userEmployee, s.companyA, s.branchA2],
      );

      const context = await build(tx).resolveMembershipContext(
        s.userEmployee,
        s.companyA,
      );
      const entitlements = context?.entitlements ?? [];

      // bookings.create is exercisable only in the agent membership's branch (A2),
      // never in the employee membership's branch (A) — no cross-product.
      expect(
        canExercisePermissionInBranch(entitlements, Permission.BookingsCreate, s.branchA2),
      ).toBe(true);
      expect(
        canExercisePermissionInBranch(entitlements, Permission.BookingsCreate, s.branchA),
      ).toBe(false);

      expect(
        effectivePermissionsForBranch(entitlements, s.branchA),
      ).not.toContain(Permission.BookingsCreate);
      // A permission both memberships share (read set) is available in both branches.
      expect(effectivePermissionsForBranch(entitlements, s.branchA)).toContain(
        Permission.TripsRead,
      );
      expect(effectivePermissionsForBranch(entitlements, s.branchA2)).toContain(
        Permission.TripsRead,
      );
    });
  });

  it('an inactive membership contributes neither permission nor branch access', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      // Employee at branch A is active; add an INACTIVE agent membership at A2.
      await tx.query(
        `INSERT INTO public.company_memberships (user_id, company_id, branch_id, role, is_active) VALUES ($1,$2,$3,'AGENT',false)`,
        [s.userEmployee, s.companyA, s.branchA2],
      );

      const context = await build(tx).resolveMembershipContext(
        s.userEmployee,
        s.companyA,
      );
      const entitlements = context?.entitlements ?? [];

      // Only the active membership survives: the inactive agent grants nothing.
      expect(entitlements).toHaveLength(1);
      expect(
        canExercisePermissionInBranch(entitlements, Permission.BookingsCreate, s.branchA2),
      ).toBe(false);
      // Its branch is not reachable either — branch access is A only.
      expect(context?.branchAccess).toEqual({
        kind: 'restricted',
        branchIds: [s.branchA],
      });
    });
  });

  it('ignores inactive memberships and denies the wrong company (tenant isolation)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const service = build(tx);

      // Outsider's only membership in company A is inactive -> no context.
      await expect(
        service.resolveMembershipContext(s.userOutsider, s.companyA),
      ).resolves.toBeNull();

      // Manager has no membership in company B -> no context.
      await expect(
        service.resolveMembershipContext(s.userManager, s.companyB),
      ).resolves.toBeNull();
    });
  });

  it('lists only the requested company memberships and scopes single reads', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const service = build(tx);

      const page = await service.listCompanyMemberships(
        s.companyA,
        resolvePagination(),
      );
      expect(page.items.every((m) => m.companyId === s.companyA)).toBe(true);
      const ids = page.items.map((m) => m.id);
      expect(ids).toEqual(expect.arrayContaining([s.membershipManager, s.membershipEmployee]));
      expect(ids).not.toContain(s.membershipOutsiderInB);

      // A membership that belongs to company B is not found under company A.
      await expect(
        service.getCompanyMembership(s.companyA, s.membershipOutsiderInB),
      ).rejects.toMatchObject({ status: 404 });

      const inCompany = await service.getCompanyMembership(
        s.companyA,
        s.membershipManager,
      );
      expect(inCompany.id).toBe(s.membershipManager);
    });
  });

  it('does not find a valid membership id addressed under the wrong company id', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      // membershipManager exists, but belongs to company A, not company B.
      await expect(
        build(tx).getCompanyMembership(s.companyB, s.membershipManager),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  it('lists the companies a user belongs to (active memberships only)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const page = await build(tx).listMyCompanies(
        s.userOutsider,
        resolvePagination(),
      );
      // The outsider's active membership is only in company B (the A one is inactive).
      expect(page.items.map((m) => m.companyId)).toEqual([s.companyB]);
    });
  });

  it('enforces tenant isolation at the database layer via RLS', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);

      // Switch to the authenticated role acting as the manager; RLS now applies.
      await tx.query(`SET LOCAL role authenticated`);
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: s.userManager, role: 'authenticated' }),
      ]);

      const profiles = await tx.query<{ id: string }>(
        `SELECT id FROM public.profiles`,
      );
      expect(profiles.rows.map((r) => r.id)).toEqual([s.userManager]);

      // The manager cannot see company B's memberships (they belong to no
      // company the manager manages or is a member of).
      const memberships = await tx.query<{ company_id: string }>(
        `SELECT company_id FROM public.company_memberships`,
      );
      expect(memberships.rows.every((r) => r.company_id === s.companyA)).toBe(
        true,
      );

      await tx.query(`RESET role`);
    });
  });
});

async function scalar(
  tx: Transaction,
  text: string,
  params: readonly unknown[],
): Promise<string> {
  const result = await tx.query<{ id: string }>(text, params);
  return String(result.rows[0].id);
}
