import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { resolvePagination } from '../../src/common/pagination/pagination';
import { DatabaseService } from '../../src/infrastructure/database';
import { DatabaseErrorMapper } from '../../src/infrastructure/database/database-error.mapper';
import {
  Transaction,
  TransactionManager,
} from '../../src/infrastructure/database/transaction.manager';
import { PostgresStationsRepository } from '../../src/modules/stations/postgres-stations.repository';
import { PostgresRoutesRepository } from '../../src/modules/routes/postgres-routes.repository';
import { PostgresRoutePricesRepository } from '../../src/modules/routes/postgres-route-prices.repository';
import { RoutesService } from '../../src/modules/routes/routes.service';
import { RoutePricesService } from '../../src/modules/routes/route-prices.service';
import {
  RouteNotFoundError,
  RouteStateConflictError,
  RouteStationInvalidError,
} from '../../src/modules/routes/route.errors';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

interface Seed {
  user: string;
  outsider: string;
  companyA: string;
  companyB: string;
  cityId: string;
  stationA: string;
  stationB: string;
  stationInactive: string;
}

describe('Routes & pricing domain (integration)', () => {
  let pool: Pool;
  let transactions: TransactionManager;
  let available = false;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
    pool.on('error', () => undefined);
    try {
      await pool.query('SELECT 1');
      available = true;
    } catch {
      available = false;
      console.warn(`[integration] No database at ${DATABASE_URL} — skipping routes assertions.`);
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
    const user = randomUUID();
    const outsider = randomUUID();
    await tx.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4)`, [
      user, `${user}@itest.local`, outsider, `${outsider}@itest.local`,
    ]);
    // profiles rows are auto-created from auth.users by a database trigger.
    const suffix = user.slice(0, 8);
    const companyA = await scalar(tx, `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`, [`RtA-${suffix}`]);
    const companyB = await scalar(tx, `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`, [`RtB-${suffix}`]);
    const cityId = await scalar(tx, `INSERT INTO public.cities (name_ar, name_fr) VALUES ($1,$2) RETURNING id`, [`م-${suffix}`, `V-${suffix}`]);
    const stationA = await scalar(tx, `INSERT INTO public.stations (city_id, name_ar, name_fr) VALUES ($1,$2,$3) RETURNING id`, [cityId, `أ-${suffix}`, `A-${suffix}`]);
    const stationB = await scalar(tx, `INSERT INTO public.stations (city_id, name_ar, name_fr) VALUES ($1,$2,$3) RETURNING id`, [cityId, `ب-${suffix}`, `B-${suffix}`]);
    const stationInactive = await scalar(tx, `INSERT INTO public.stations (city_id, name_ar, name_fr, is_active) VALUES ($1,$2,$3,false) RETURNING id`, [cityId, `ج-${suffix}`, `C-${suffix}`]);
    await tx.query(`INSERT INTO public.company_memberships (user_id, company_id, role) VALUES ($1,$2,'COMPANY_MANAGER')`, [user, companyA]);
    await tx.query(`INSERT INTO public.company_memberships (user_id, company_id, role) VALUES ($1,$2,'COMPANY_MANAGER')`, [outsider, companyB]);
    return { user, outsider, companyA, companyB, cityId, stationA, stationB, stationInactive };
  }

  /** Build the routes + pricing services bound to a single rollback transaction. */
  function buildTxManager(tx: Transaction): TransactionManager {
    // Each service "transaction" runs against the outer rollback tx inside its
    // own SAVEPOINT, so an expected failure rolls back just that operation (as a
    // real separate transaction would) without poisoning the shared connection.
    let sp = 0;
    return {
      run: async <T>(work: (t: Transaction) => Promise<T>): Promise<T> => {
        const name = `sp_${++sp}`;
        await tx.query(`SAVEPOINT ${name}`);
        try {
          const result = await work(tx);
          await tx.query(`RELEASE SAVEPOINT ${name}`);
          return result;
        } catch (error) {
          await tx.query(`ROLLBACK TO SAVEPOINT ${name}`);
          throw error;
        }
      },
    } as unknown as TransactionManager;
  }

  function build(tx: Transaction): {
    routes: RoutesService;
    prices: RoutePricesService;
    routesRepo: PostgresRoutesRepository;
    pricesRepo: PostgresRoutePricesRepository;
    txManager: TransactionManager;
    db: DatabaseService;
  } {
    const routesRepo = new PostgresRoutesRepository();
    const pricesRepo = new PostgresRoutePricesRepository();
    const stationsRepo = new PostgresStationsRepository(tx);
    const txManager = buildTxManager(tx);
    const db = tx as unknown as DatabaseService;
    return {
      routes: new RoutesService(routesRepo, pricesRepo, stationsRepo, db, txManager),
      prices: new RoutePricesService(pricesRepo, routesRepo, db, txManager),
      routesRepo,
      pricesRepo,
      txManager,
      db,
    };
  }

  it('creates a route, seeds its initial open price period, and lists it (company-scoped)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { routes, prices } = build(tx);
      const route = await routes.createRoute(s.companyA, {
        originStationId: s.stationA, destinationStationId: s.stationB,
        defaultPriceMru: 500, currency: 'MRU', estimatedDurationMinutes: 300,
      });
      expect(route.companyId).toBe(s.companyA);
      expect(route.defaultPriceMru).toBe(500);

      const history = await prices.listPriceHistory(s.companyA, route.id, resolvePagination());
      expect(history.total).toBe(1);
      expect(history.items[0]).toMatchObject({ priceMru: 500, changeReason: 'Initial price' });
      expect(history.items[0].effectiveTo).toBeUndefined();

      const page = await routes.listRoutes(s.companyA, resolvePagination());
      expect(page.items.map((r) => r.id)).toContain(route.id);
      expect(page.total).toBe(1);
    });
  });

  it('rejects same-station and inactive-station routes (422)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { routes } = build(tx);
      await expect(routes.createRoute(s.companyA, {
        originStationId: s.stationA, destinationStationId: s.stationA,
        defaultPriceMru: 500, currency: 'MRU', estimatedDurationMinutes: 300,
      })).rejects.toBeInstanceOf(RouteStationInvalidError);
      await expect(routes.createRoute(s.companyA, {
        originStationId: s.stationA, destinationStationId: s.stationInactive,
        defaultPriceMru: 500, currency: 'MRU', estimatedDurationMinutes: 300,
      })).rejects.toBeInstanceOf(RouteStationInvalidError);
    });
  });

  it('rejects a duplicate origin/destination route (unique → 409)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { routes } = build(tx);
      const input = { originStationId: s.stationA, destinationStationId: s.stationB, defaultPriceMru: 500, currency: 'MRU', estimatedDurationMinutes: 300 };
      await routes.createRoute(s.companyA, input);
      await expect(routes.createRoute(s.companyA, input)).rejects.toMatchObject({ status: 409 });
    });
  });

  it('isolates routes across companies (cross-company 404)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { routes } = build(tx);
      const route = await routes.createRoute(s.companyA, {
        originStationId: s.stationA, destinationStationId: s.stationB,
        defaultPriceMru: 500, currency: 'MRU', estimatedDurationMinutes: 300,
      });
      await expect(routes.getRoute(s.companyB, route.id)).rejects.toBeInstanceOf(RouteNotFoundError);
    });
  });

  it('records a new price: contiguous periods (no gap/overlap), one open period, mirrored default', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { routes, prices } = build(tx);
      const route = await routes.createRoute(s.companyA, {
        originStationId: s.stationA, destinationStationId: s.stationB,
        defaultPriceMru: 500, currency: 'MRU', estimatedDurationMinutes: 300,
      });
      const newPrice = await prices.createPrice(s.companyA, route.id, { priceMru: 750, currency: 'MRU', changeReason: 'Peak', changedByUserId: s.user });
      expect(newPrice.priceMru).toBe(750);
      expect(newPrice.effectiveTo).toBeUndefined();

      const history = await prices.listPriceHistory(s.companyA, route.id, resolvePagination());
      expect(history.total).toBe(2);
      const [current, previous] = history.items; // newest first
      expect(current).toMatchObject({ priceMru: 750 });
      expect(previous).toMatchObject({ priceMru: 500 });

      // Exactly one open period.
      expect(history.items.filter((p) => p.effectiveTo === undefined)).toHaveLength(1);
      // Contiguity: the closed period ends exactly where the open one begins —
      // no gap, no overlap.
      expect(previous.effectiveTo).toBeDefined();
      expect(previous.effectiveTo?.getTime()).toBe(current.effectiveFrom.getTime());
      // Sanity: the boundary is strictly after the previous period started.
      expect(previous.effectiveTo!.getTime()).toBeGreaterThan(previous.effectiveFrom.getTime());

      // The route's current default price now reflects the new price.
      const reread = await routes.getRoute(s.companyA, route.id);
      expect(reread.defaultPriceMru).toBe(750);
    });
  });

  it('rolls back both the history change and the route mirror when the price change fails', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { routes, pricesRepo, txManager, db } = build(tx);
      const route = await routes.createRoute(s.companyA, {
        originStationId: s.stationA, destinationStationId: s.stationB,
        defaultPriceMru: 500, currency: 'MRU', estimatedDurationMinutes: 300,
      });

      // A routes repo whose default-price mirror throws *after* the history
      // period was written, to prove the whole transaction rolls back.
      const throwingRoutes = new PostgresRoutesRepository();
      throwingRoutes.updateDefaultPrice = () => Promise.reject(new Error('mirror failed'));
      const prices = new RoutePricesService(pricesRepo, throwingRoutes, db, txManager);

      await expect(
        prices.createPrice(s.companyA, route.id, { priceMru: 999, currency: 'MRU', changedByUserId: s.user }),
      ).rejects.toThrow('mirror failed');

      // History untouched (still just the initial 500 period, still open) and the
      // route default unchanged.
      const history = await pricesRepo.listHistoryByRoute(tx, route.id, resolvePagination());
      expect(history.total).toBe(1);
      expect(history.items[0]).toMatchObject({ priceMru: 500 });
      expect(history.items[0].effectiveTo).toBeUndefined();
      const reread = await routes.getRoute(s.companyA, route.id);
      expect(reread.defaultPriceMru).toBe(500);
    });
  });

  it('rejects a pricing change on another company\'s route (404)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { routes, prices } = build(tx);
      const route = await routes.createRoute(s.companyA, {
        originStationId: s.stationA, destinationStationId: s.stationB,
        defaultPriceMru: 500, currency: 'MRU', estimatedDurationMinutes: 300,
      });
      await expect(prices.createPrice(s.companyB, route.id, { priceMru: 1, currency: 'MRU' })).rejects.toBeInstanceOf(RouteNotFoundError);
    });
  });

  it('rejects a second open price period at the database (partial unique → 409)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { routes } = build(tx);
      const pricesRepo = new PostgresRoutePricesRepository();
      const route = await routes.createRoute(s.companyA, {
        originStationId: s.stationA, destinationStationId: s.stationB,
        defaultPriceMru: 500, currency: 'MRU', estimatedDurationMinutes: 300,
      });
      // Route creation already opened one period; a second open period (without
      // closing the first) violates uq_route_open_price_period.
      await expect(pricesRepo.openInitialPeriod(tx, route.id, { priceMru: 900, currency: 'MRU' })).rejects.toMatchObject({ status: 409 });
    });
  });

  it('transitions activation and conflicts on a redundant transition', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { routes } = build(tx);
      const route = await routes.createRoute(s.companyA, {
        originStationId: s.stationA, destinationStationId: s.stationB,
        defaultPriceMru: 500, currency: 'MRU', estimatedDurationMinutes: 300,
      });
      const off = await routes.setRouteActive(s.companyA, route.id, false);
      expect(off.isActive).toBe(false);
      await expect(routes.setRouteActive(s.companyA, route.id, false)).rejects.toBeInstanceOf(RouteStateConflictError);
    });
  });

  it('enforces route + price-history visibility via RLS (non-bypassing role)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { routes } = build(tx);
      const route = await routes.createRoute(s.companyA, {
        originStationId: s.stationA, destinationStationId: s.stationB,
        defaultPriceMru: 500, currency: 'MRU', estimatedDurationMinutes: 300,
      });

      // As the company A member: sees the route and its price history.
      await tx.query(`SET LOCAL role authenticated`);
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: s.user, role: 'authenticated' })]);
      const memberRoutes = await tx.query<{ id: string }>(`SELECT id FROM public.routes WHERE company_id = $1`, [s.companyA]);
      expect(memberRoutes.rows.map((r) => r.id)).toEqual([route.id]);
      const memberPrices = await tx.query<{ id: string }>(`SELECT id FROM public.route_price_history WHERE route_id = $1`, [route.id]);
      expect(memberPrices.rows.length).toBeGreaterThanOrEqual(1);
      await tx.query(`RESET role`);

      // As an outsider (company B): sees neither.
      await tx.query(`SET LOCAL role authenticated`);
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: s.outsider, role: 'authenticated' })]);
      const outsiderRoutes = await tx.query(`SELECT id FROM public.routes WHERE company_id = $1`, [s.companyA]);
      expect(outsiderRoutes.rows).toHaveLength(0);
      const outsiderPrices = await tx.query(`SELECT id FROM public.route_price_history WHERE route_id = $1`, [route.id]);
      expect(outsiderPrices.rows).toHaveLength(0);
      await tx.query(`RESET role`);
    });
  });

  it('lets only one of two concurrent price changes commit (exactly one open period)', async () => {
    if (!available) return;
    // Committed fixture (two connections cannot share an uncommitted rollback tx).
    const suffix = randomUUID().slice(0, 8);
    const owner = randomUUID();
    await pool.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, [owner, `${owner}@itest.local`]);
    const companyId = String((await pool.query(`INSERT INTO public.companies (name) VALUES ($1) RETURNING id`, [`Pc-${suffix}`])).rows[0].id);
    const city = String((await pool.query(`INSERT INTO public.cities (name_ar, name_fr) VALUES ($1,$2) RETURNING id`, [`مp-${suffix}`, `Vp-${suffix}`])).rows[0].id);
    const s1 = String((await pool.query(`INSERT INTO public.stations (city_id, name_ar, name_fr) VALUES ($1,$2,$3) RETURNING id`, [city, `أp-${suffix}`, `Ap-${suffix}`])).rows[0].id);
    const s2 = String((await pool.query(`INSERT INTO public.stations (city_id, name_ar, name_fr) VALUES ($1,$2,$3) RETURNING id`, [city, `بp-${suffix}`, `Bp-${suffix}`])).rows[0].id);
    const routeId = String((await pool.query(`INSERT INTO public.routes (company_id, origin_station_id, destination_station_id, default_price_mru, estimated_duration_minutes) VALUES ($1,$2,$3,500,300) RETURNING id`, [companyId, s1, s2])).rows[0].id);
    await pool.query(`INSERT INTO public.route_price_history (route_id, price_mru, change_reason) VALUES ($1, 500, 'seed')`, [routeId]);

    const change = (price: number) =>
      transactions.run(async (tx) => {
        const prices = new RoutePricesService(
          new PostgresRoutePricesRepository(),
          new PostgresRoutesRepository(),
          tx as unknown as DatabaseService,
          { run: <T>(work: (t: Transaction) => Promise<T>) => work(tx) } as unknown as TransactionManager,
        );
        return prices.createPrice(companyId, routeId, { priceMru: price, currency: 'MRU' });
      });

    try {
      const results = await Promise.allSettled([change(600), change(700)]);
      // At least one change must make progress; any that lost the race must fail
      // cleanly as a 409 (never a 500). Whether the second succeeds (it serialized
      // and closed the first's period) or conflicts is timing-dependent — what
      // matters is the invariant below.
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
      for (const r of results) {
        if (r.status === 'rejected') {
          expect(r.reason).toMatchObject({ status: 409 });
        }
      }

      // Invariant: exactly one open period survives — never zero, never two.
      // The partial-unique index makes two simultaneous open periods impossible.
      const open = await pool.query(
        `SELECT count(*)::int AS n FROM public.route_price_history WHERE route_id = $1 AND effective_to IS NULL`,
        [routeId],
      );
      expect(open.rows[0].n).toBe(1);

      // And no two periods overlap (contiguity/exclusion holds across all rows).
      const overlaps = await pool.query(
        `SELECT count(*)::int AS n
           FROM public.route_price_history a
           JOIN public.route_price_history b
             ON a.route_id = b.route_id AND a.id < b.id
            AND tstzrange(a.effective_from, a.effective_to, '[)')
              && tstzrange(b.effective_from, b.effective_to, '[)')
          WHERE a.route_id = $1`,
        [routeId],
      );
      expect(overlaps.rows[0].n).toBe(0);
    } finally {
      await pool.query(`DELETE FROM public.route_price_history WHERE route_id = $1`, [routeId]);
      await pool.query(`DELETE FROM public.routes WHERE company_id = $1`, [companyId]);
      await pool.query(`DELETE FROM public.stations WHERE city_id = $1`, [city]);
      await pool.query(`DELETE FROM public.cities WHERE id = $1`, [city]);
      await pool.query(`DELETE FROM public.company_settings WHERE company_id = $1`, [companyId]);
      await pool.query(`DELETE FROM public.companies WHERE id = $1`, [companyId]);
      await pool.query(`DELETE FROM auth.users WHERE id = $1`, [owner]);
    }
  });
});
