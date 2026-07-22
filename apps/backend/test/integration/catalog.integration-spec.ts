import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { resolvePagination } from '../../src/common/pagination/pagination';
import { DatabaseErrorMapper } from '../../src/infrastructure/database/database-error.mapper';
import {
  Transaction,
  TransactionManager,
} from '../../src/infrastructure/database/transaction.manager';
import { PostgresCitiesRepository } from '../../src/modules/cities/postgres-cities.repository';
import { PostgresStationsRepository } from '../../src/modules/stations/postgres-stations.repository';
import { PostgresSeatLayoutsRepository } from '../../src/modules/seat-layouts/postgres-seat-layouts.repository';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** A large page so seeded reference rows never push our fixtures off the first page. */
const WIDE = resolvePagination({ page: 1, pageSize: 100 });

describe('Catalog domain (integration)', () => {
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
      console.warn(`[integration] No database at ${DATABASE_URL} — skipping catalog assertions.`);
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

  it('lists active cities and hides inactive ones', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const activeId = await scalar(tx, `INSERT INTO public.cities (name_ar, name_fr) VALUES ($1,$2) RETURNING id`, [`نشط-${suffix}`, `Actif-${suffix}`]);
      const inactiveId = await scalar(tx, `INSERT INTO public.cities (name_ar, name_fr, is_active) VALUES ($1,$2,false) RETURNING id`, [`خامل-${suffix}`, `Inactif-${suffix}`]);

      const repo = new PostgresCitiesRepository(tx);
      const page = await repo.listActive(WIDE);
      const ids = page.items.map((c) => c.id);
      expect(ids).toContain(activeId);
      expect(ids).not.toContain(inactiveId);

      await expect(repo.findActiveById(activeId)).resolves.toMatchObject({ id: activeId });
      await expect(repo.findActiveById(inactiveId)).resolves.toBeNull();
    });
  });

  it('lists active stations, filters by city, and hides deleted/inactive', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const cityId = await scalar(tx, `INSERT INTO public.cities (name_ar, name_fr) VALUES ($1,$2) RETURNING id`, [`مدينة-${suffix}`, `Ville-${suffix}`]);
      const active = await scalar(tx, `INSERT INTO public.stations (city_id, name_ar, name_fr) VALUES ($1,$2,$3) RETURNING id`, [cityId, `نشطة-${suffix}`, `ActiveGare-${suffix}`]);
      const deleted = await scalar(tx, `INSERT INTO public.stations (city_id, name_ar, name_fr, deleted_at) VALUES ($1,$2,$3, now()) RETURNING id`, [cityId, `محذوفة-${suffix}`, `DeletedGare-${suffix}`]);

      const repo = new PostgresStationsRepository(tx);
      const filtered = await repo.listActive(WIDE, cityId);
      expect(filtered.items.map((s) => s.id)).toEqual([active]);
      expect(filtered.total).toBe(1);

      await expect(repo.findActiveById(active)).resolves.toMatchObject({ id: active, cityId });
      await expect(repo.findActiveById(deleted)).resolves.toBeNull();
    });
  });

  it('reads a seat layout with its canonical seat labels', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const id = await scalar(
        tx,
        `INSERT INTO public.seat_layouts (name, total_seats, layout_grid) VALUES ($1, 3, '["1","2","3"]'::jsonb) RETURNING id`,
        [`Layout-${suffix}`],
      );
      const repo = new PostgresSeatLayoutsRepository(tx);
      await expect(repo.findById(id)).resolves.toMatchObject({
        id,
        totalSeats: 3,
        seatNumbers: ['1', '2', '3'],
      });
    });
  });

  it('exposes reference reads through RLS to any authenticated user', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const user = randomUUID();
      await tx.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, [user, `${user}@itest.local`]);
      const activeCity = await scalar(tx, `INSERT INTO public.cities (name_ar, name_fr) VALUES ($1,$2) RETURNING id`, [`rls-${suffix}`, `Rls-${suffix}`]);
      await tx.query(`INSERT INTO public.cities (name_ar, name_fr, is_active) VALUES ($1,$2,false)`, [`rlsx-${suffix}`, `RlsX-${suffix}`]);

      // cities_read_active admits any authenticated user to active rows only.
      await tx.query(`SET LOCAL role authenticated`);
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: user, role: 'authenticated' }),
      ]);
      const visible = await tx.query<{ id: string }>(
        `SELECT id FROM public.cities WHERE name_fr LIKE $1 ORDER BY id`,
        [`Rls%-${suffix}`],
      );
      expect(visible.rows.map((r) => r.id)).toEqual([activeCity]);
      await tx.query(`RESET role`);
    });
  });
});
