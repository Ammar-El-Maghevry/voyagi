import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { resolvePagination } from '../../src/common/pagination/pagination';
import { DatabaseService } from '../../src/infrastructure/database';
import { DatabaseErrorMapper } from '../../src/infrastructure/database/database-error.mapper';
import {
  Transaction,
  TransactionManager,
} from '../../src/infrastructure/database/transaction.manager';
import { PostgresTripsRepository } from '../../src/modules/trips/postgres-trips.repository';
import { PostgresTripEventsRepository } from '../../src/modules/trips/postgres-trip-events.repository';
import { TripsService } from '../../src/modules/trips/trips.service';
import { TripEventsService } from '../../src/modules/trips/trip-events.service';
import {
  TripAssociationInvalidError,
  TripNotFoundError,
  TripTransitionConflictError,
  TripVersionConflictError,
} from '../../src/modules/trips/trip.errors';
import { TripAction } from '../../src/modules/trips/trip-transitions';
import { TripStatus } from '../../src/modules/trips/trip-status';
import type { MaintenanceSchedulingPort } from '../../src/modules/maintenance/maintenance-scheduling.port';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const DEP = new Date('2026-03-01T08:00:00.000Z');
const ARR = new Date('2026-03-01T13:00:00.000Z');
const DEP2_OVERLAP = new Date('2026-03-01T10:00:00.000Z');
const ARR2_OVERLAP = new Date('2026-03-01T15:00:00.000Z');
const DEP3_CLEAR = new Date('2026-03-01T14:00:00.000Z');
const ARR3_CLEAR = new Date('2026-03-01T18:00:00.000Z');
const noMaintenance: MaintenanceSchedulingPort = {
  hasActiveMaintenanceOverlap: () => Promise.resolve(false),
};

interface Seed {
  user: string;
  outsider: string;
  companyA: string;
  companyB: string;
  routeA: string;
  routeAInactive: string;
  routeB: string;
  busA: string;
  busAInactive: string;
  busB: string;
  driverA: string;
  assistantA: string;
  driverInactive: string;
  driverDeleted: string;
  driverB: string;
}

describe('Trips domain (integration)', () => {
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
      console.warn(`[integration] No database at ${DATABASE_URL} — skipping trips assertions.`);
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

  async function scalar(exec: { query: Transaction['query'] }, text: string, params: readonly unknown[]): Promise<string> {
    const result = await exec.query<{ id: string }>(text, params);
    return String(result.rows[0].id);
  }

  async function seed(tx: Transaction): Promise<Seed> {
    const user = randomUUID();
    const outsider = randomUUID();
    await tx.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4)`, [
      user, `${user}@itest.local`, outsider, `${outsider}@itest.local`,
    ]);
    const suffix = user.slice(0, 8);
    const companyA = await scalar(tx, `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`, [`TrA-${suffix}`]);
    const companyB = await scalar(tx, `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`, [`TrB-${suffix}`]);
    const city = await scalar(tx, `INSERT INTO public.cities (name_ar, name_fr) VALUES ($1,$2) RETURNING id`, [`م-${suffix}`, `V-${suffix}`]);
    const st1 = await scalar(tx, `INSERT INTO public.stations (city_id, name_ar, name_fr) VALUES ($1,$2,$3) RETURNING id`, [city, `أ-${suffix}`, `A-${suffix}`]);
    const st2 = await scalar(tx, `INSERT INTO public.stations (city_id, name_ar, name_fr) VALUES ($1,$2,$3) RETURNING id`, [city, `ب-${suffix}`, `B-${suffix}`]);
    const layout = await scalar(tx, `INSERT INTO public.seat_layouts (name, total_seats, layout_grid) VALUES ($1, 2, '["1","2"]'::jsonb) RETURNING id`, [`L-${suffix}`]);

    const routeA = await scalar(tx, `INSERT INTO public.routes (company_id, origin_station_id, destination_station_id, default_price_mru, estimated_duration_minutes) VALUES ($1,$2,$3,500,300) RETURNING id`, [companyA, st1, st2]);
    const routeAInactive = await scalar(tx, `INSERT INTO public.routes (company_id, origin_station_id, destination_station_id, default_price_mru, estimated_duration_minutes, is_active) VALUES ($1,$2,$3,500,300,false) RETURNING id`, [companyA, st2, st1]);
    const routeB = await scalar(tx, `INSERT INTO public.routes (company_id, origin_station_id, destination_station_id, default_price_mru, estimated_duration_minutes) VALUES ($1,$2,$3,500,300) RETURNING id`, [companyB, st1, st2]);

    const busA = await scalar(tx, `INSERT INTO public.buses (company_id, seat_layout_id, plate_number) VALUES ($1,$2,$3) RETURNING id`, [companyA, layout, `PA-${suffix}`]);
    const busAInactive = await scalar(tx, `INSERT INTO public.buses (company_id, seat_layout_id, plate_number, is_active) VALUES ($1,$2,$3,false) RETURNING id`, [companyA, layout, `PAI-${suffix}`]);
    const busB = await scalar(tx, `INSERT INTO public.buses (company_id, seat_layout_id, plate_number) VALUES ($1,$2,$3) RETURNING id`, [companyB, layout, `PB-${suffix}`]);
    const driverA = await scalar(tx, `INSERT INTO public.staff_members (company_id, full_name, staff_type) VALUES ($1,$2,'DRIVER') RETURNING id`, [companyA, `Drv-${suffix}`]);
    const assistantA = await scalar(tx, `INSERT INTO public.staff_members (company_id, full_name, staff_type) VALUES ($1,$2,'ASSISTANT') RETURNING id`, [companyA, `Ast-${suffix}`]);
    const driverInactive = await scalar(tx, `INSERT INTO public.staff_members (company_id, full_name, staff_type, is_active) VALUES ($1,$2,'DRIVER',false) RETURNING id`, [companyA, `DrvI-${suffix}`]);
    const driverDeleted = await scalar(tx, `INSERT INTO public.staff_members (company_id, full_name, staff_type, deleted_at) VALUES ($1,$2,'DRIVER', now()) RETURNING id`, [companyA, `DrvD-${suffix}`]);
    const driverB = await scalar(tx, `INSERT INTO public.staff_members (company_id, full_name, staff_type) VALUES ($1,$2,'DRIVER') RETURNING id`, [companyB, `DrvB-${suffix}`]);

    await tx.query(`INSERT INTO public.company_memberships (user_id, company_id, role) VALUES ($1,$2,'COMPANY_MANAGER')`, [user, companyA]);
    await tx.query(`INSERT INTO public.company_memberships (user_id, company_id, role) VALUES ($1,$2,'COMPANY_MANAGER')`, [outsider, companyB]);

    return { user, outsider, companyA, companyB, routeA, routeAInactive, routeB, busA, busAInactive, busB, driverA, assistantA, driverInactive, driverDeleted, driverB };
  }

  function build(tx: Transaction): { trips: TripsService; events: TripEventsService } {
    const tripsRepo = new PostgresTripsRepository();
    const eventsRepo = new PostgresTripEventsRepository();
    // Each service "transaction" runs against the outer rollback tx but inside
    // its own SAVEPOINT, so an expected failure (e.g. a schedule overlap) rolls
    // back just that operation — as a real separate transaction would — instead
    // of poisoning the shared connection for the next call.
    let sp = 0;
    const txManager = {
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
    const db = tx as unknown as DatabaseService;
    return {
      trips: new TripsService(tripsRepo, eventsRepo, db, txManager, noMaintenance),
      events: new TripEventsService(eventsRepo, tripsRepo, db),
    };
  }

  const create = (routeId: string, busId: string, extra: Partial<{ driverId: string; departureTime: Date; estimatedArrivalTime: Date }> = {}) => ({
    routeId, busId,
    departureTime: extra.departureTime ?? DEP,
    estimatedArrivalTime: extra.estimatedArrivalTime ?? ARR,
    driverId: extra.driverId,
  });

  it('schedules a trip: snapshots price, computes boarding time, appends TRIP_CREATED', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { trips, events } = build(tx);
      const trip = await trips.createTrip(s.companyA, create(s.routeA, s.busA, { driverId: s.driverA }), s.user);
      expect(trip).toMatchObject({ companyId: s.companyA, status: TripStatus.Scheduled, priceMru: 500, version: 1 });
      // boarding = departure − 30 min (default company setting).
      expect(trip.boardingClosesAt.toISOString()).toBe('2026-03-01T07:30:00.000Z');

      const evts = await events.listTripEvents(s.companyA, trip.id, resolvePagination());
      expect(evts.items.map((e) => e.eventType)).toEqual(['TRIP_CREATED']);
    });
  });

  it('rejects cross-company route/bus and inactive/non-operational associations (422)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { trips } = build(tx);
      // Bus belongs to company B — not visible/assignable in company A.
      await expect(trips.createTrip(s.companyA, create(s.routeA, s.busB), s.user)).rejects.toBeInstanceOf(TripAssociationInvalidError);
      // Route belongs to company B.
      await expect(trips.createTrip(s.companyA, create(s.routeB, s.busA), s.user)).rejects.toBeInstanceOf(TripAssociationInvalidError);
      // Inactive route / inactive bus.
      await expect(trips.createTrip(s.companyA, create(s.routeAInactive, s.busA), s.user)).rejects.toBeInstanceOf(TripAssociationInvalidError);
      await expect(trips.createTrip(s.companyA, create(s.routeA, s.busAInactive), s.user)).rejects.toBeInstanceOf(TripAssociationInvalidError);
    });
  });

  it('validates driver/assistant in-transaction: cross-company, wrong type, inactive, soft-deleted (422)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { trips } = build(tx);
      const withStaff = (driverId?: string, assistantId?: string) => ({
        routeId: s.routeA, busId: s.busA, departureTime: DEP, estimatedArrivalTime: ARR, driverId, assistantId,
      });
      // Cross-company driver.
      await expect(trips.createTrip(s.companyA, withStaff(s.driverB), s.user)).rejects.toBeInstanceOf(TripAssociationInvalidError);
      // Wrong type (an ASSISTANT supplied as the driver).
      await expect(trips.createTrip(s.companyA, withStaff(s.assistantA), s.user)).rejects.toBeInstanceOf(TripAssociationInvalidError);
      // Inactive driver.
      await expect(trips.createTrip(s.companyA, withStaff(s.driverInactive), s.user)).rejects.toBeInstanceOf(TripAssociationInvalidError);
      // Soft-deleted driver (the DB staff-type trigger would miss this; the app check catches it).
      await expect(trips.createTrip(s.companyA, withStaff(s.driverDeleted), s.user)).rejects.toBeInstanceOf(TripAssociationInvalidError);
      // Wrong type for the assistant slot (a DRIVER supplied as the assistant).
      await expect(trips.createTrip(s.companyA, withStaff(s.driverA, s.driverA), s.user)).rejects.toBeInstanceOf(TripAssociationInvalidError);
      // A valid active DRIVER + ASSISTANT of the company → accepted.
      const ok = await trips.createTrip(s.companyA, withStaff(s.driverA, s.assistantA), s.user);
      expect(ok).toMatchObject({ driverId: s.driverA, assistantId: s.assistantA });
    });
  });

  it('releases a cancelled trip\'s window so another trip can be scheduled on the same bus', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { trips } = build(tx);
      const first = await trips.createTrip(s.companyA, create(s.routeA, s.busA, { departureTime: DEP, estimatedArrivalTime: ARR }), s.user);
      // Same bus + same window is blocked while the first trip is live.
      await expect(
        trips.createTrip(s.companyA, create(s.routeA, s.busA, { departureTime: DEP, estimatedArrivalTime: ARR }), s.user),
      ).rejects.toMatchObject({ status: 409 });
      // Cancel the first trip → its window is released.
      await trips.applyTransition(s.companyA, first.id, TripAction.Cancel, s.user);
      const second = await trips.createTrip(s.companyA, create(s.routeA, s.busA, { departureTime: DEP, estimatedArrivalTime: ARR }), s.user);
      expect(second.id).toBeDefined();
      expect(second.id).not.toBe(first.id);
    });
  });

  it('rejects invalid scheduled times at the database (check → 422)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { trips } = build(tx);
      await expect(
        trips.createTrip(s.companyA, create(s.routeA, s.busA, { departureTime: ARR, estimatedArrivalTime: DEP }), s.user),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  it('prevents overlapping bus schedules and allows non-overlapping ones (exclusion → 409)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { trips } = build(tx);
      await trips.createTrip(s.companyA, create(s.routeA, s.busA, { departureTime: DEP, estimatedArrivalTime: ARR }), s.user);
      // Overlapping window on the same bus → conflict.
      await expect(
        trips.createTrip(s.companyA, create(s.routeA, s.busA, { departureTime: DEP2_OVERLAP, estimatedArrivalTime: ARR2_OVERLAP }), s.user),
      ).rejects.toMatchObject({ status: 409 });
      // Back-to-back / non-overlapping window succeeds.
      const ok = await trips.createTrip(s.companyA, create(s.routeA, s.busA, { departureTime: DEP3_CLEAR, estimatedArrivalTime: ARR3_CLEAR }), s.user);
      expect(ok.id).toBeDefined();
    });
  });

  it('runs the lifecycle start → complete with events and server timestamps', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { trips, events } = build(tx);
      const trip = await trips.createTrip(s.companyA, create(s.routeA, s.busA), s.user);

      const started = await trips.applyTransition(s.companyA, trip.id, TripAction.Start, s.user);
      expect(started.status).toBe(TripStatus.Ongoing);
      expect(started.actualDepartureTime).toBeInstanceOf(Date);

      const completed = await trips.applyTransition(s.companyA, trip.id, TripAction.Complete, s.user);
      expect(completed.status).toBe(TripStatus.Completed);
      expect(completed.actualArrivalTime).toBeInstanceOf(Date);

      const evts = await events.listTripEvents(s.companyA, trip.id, resolvePagination());
      expect(evts.items.map((e) => e.eventType)).toEqual(['ARRIVED', 'DEPARTED', 'TRIP_CREATED']);
    });
  });

  it('rejects invalid transitions and cross-company access', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { trips } = build(tx);
      const trip = await trips.createTrip(s.companyA, create(s.routeA, s.busA), s.user);
      // Cannot complete a SCHEDULED trip.
      await expect(trips.applyTransition(s.companyA, trip.id, TripAction.Complete, s.user)).rejects.toBeInstanceOf(TripTransitionConflictError);
      // Wrong company → not found.
      await expect(trips.applyTransition(s.companyB, trip.id, TripAction.Start, s.user)).rejects.toBeInstanceOf(TripNotFoundError);
      // Cancel then re-cancel → conflict (terminal).
      await trips.applyTransition(s.companyA, trip.id, TripAction.Cancel, s.user);
      await expect(trips.applyTransition(s.companyA, trip.id, TripAction.Cancel, s.user)).rejects.toBeInstanceOf(TripTransitionConflictError);
    });
  });

  it('enforces optimistic locking on edits (stale version → 409)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { trips } = build(tx);
      const trip = await trips.createTrip(s.companyA, create(s.routeA, s.busA), s.user);
      const updated = await trips.updateTrip(s.companyA, trip.id, trip.version, { estimatedArrivalTime: new Date('2026-03-01T14:00:00.000Z') });
      expect(updated.version).toBe(trip.version + 1);
      // Reusing the old version now fails.
      await expect(trips.updateTrip(s.companyA, trip.id, trip.version, { estimatedArrivalTime: ARR })).rejects.toBeInstanceOf(TripVersionConflictError);
    });
  });

  it('keeps trip events append-only (update/delete blocked by trigger)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { trips } = build(tx);
      const trip = await trips.createTrip(s.companyA, create(s.routeA, s.busA), s.user);
      await expect(tx.query(`UPDATE public.trip_events SET event_type = 'DELAYED' WHERE trip_id = $1`, [trip.id])).rejects.toBeDefined();
      await expect(tx.query(`DELETE FROM public.trip_events WHERE trip_id = $1`, [trip.id])).rejects.toBeDefined();
    });
  });

  it('enforces trip + event visibility via RLS (non-bypassing role)', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { trips } = build(tx);
      const trip = await trips.createTrip(s.companyA, create(s.routeA, s.busA), s.user);

      await tx.query(`SET LOCAL role authenticated`);
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: s.user, role: 'authenticated' })]);
      const member = await tx.query<{ id: string }>(`SELECT id FROM public.trips WHERE company_id = $1`, [s.companyA]);
      expect(member.rows.map((r) => r.id)).toEqual([trip.id]);
      const memberEvents = await tx.query(`SELECT id FROM public.trip_events WHERE trip_id = $1`, [trip.id]);
      expect(memberEvents.rows.length).toBeGreaterThanOrEqual(1);
      await tx.query(`RESET role`);

      await tx.query(`SET LOCAL role authenticated`);
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: s.outsider, role: 'authenticated' })]);
      const outsider = await tx.query(`SELECT id FROM public.trips WHERE company_id = $1`, [s.companyA]);
      expect(outsider.rows).toHaveLength(0);
      await tx.query(`RESET role`);
    });
  });

  it('prevents two concurrent overlapping bus assignments (only one commits)', async () => {
    if (!available) return;
    // Committed fixture (two connections cannot share an uncommitted rollback tx).
    const suffix = randomUUID().slice(0, 8);
    const owner = randomUUID();
    await pool.query(`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, [owner, `${owner}@itest.local`]);
    const companyId = String((await pool.query(`INSERT INTO public.companies (name) VALUES ($1) RETURNING id`, [`Cc-${suffix}`])).rows[0].id);
    const city = String((await pool.query(`INSERT INTO public.cities (name_ar, name_fr) VALUES ($1,$2) RETURNING id`, [`مc-${suffix}`, `Vc-${suffix}`])).rows[0].id);
    const s1 = String((await pool.query(`INSERT INTO public.stations (city_id, name_ar, name_fr) VALUES ($1,$2,$3) RETURNING id`, [city, `أc-${suffix}`, `Ac-${suffix}`])).rows[0].id);
    const s2 = String((await pool.query(`INSERT INTO public.stations (city_id, name_ar, name_fr) VALUES ($1,$2,$3) RETURNING id`, [city, `بc-${suffix}`, `Bc-${suffix}`])).rows[0].id);
    const layout = String((await pool.query(`INSERT INTO public.seat_layouts (name, total_seats, layout_grid) VALUES ($1,2,'["1","2"]'::jsonb) RETURNING id`, [`Lc-${suffix}`])).rows[0].id);
    const routeId = String((await pool.query(`INSERT INTO public.routes (company_id, origin_station_id, destination_station_id, default_price_mru, estimated_duration_minutes) VALUES ($1,$2,$3,500,300) RETURNING id`, [companyId, s1, s2])).rows[0].id);
    const busId = String((await pool.query(`INSERT INTO public.buses (company_id, seat_layout_id, plate_number) VALUES ($1,$2,$3) RETURNING id`, [companyId, layout, `PCc-${suffix}`])).rows[0].id);

    const attempt = (dep: Date, arr: Date) =>
      transactions.run(async (tx) => {
        const trips = new TripsService(
          new PostgresTripsRepository(),
          new PostgresTripEventsRepository(),
           tx as unknown as DatabaseService,
           { run: <T>(work: (t: Transaction) => Promise<T>) => work(tx) } as unknown as TransactionManager,
           noMaintenance,
        );
        return trips.createTrip(companyId, { routeId, busId, departureTime: dep, estimatedArrivalTime: arr }, owner);
      });

    try {
      const results = await Promise.allSettled([
        attempt(DEP, ARR),
        attempt(DEP2_OVERLAP, ARR2_OVERLAP),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    } finally {
      // trip_events is append-only (a trigger blocks DELETE); disable it briefly
      // to remove just this fixture's rows, then restore it.
      await pool.query(`ALTER TABLE public.trip_events DISABLE TRIGGER trip_events_append_only`);
      await pool.query(`DELETE FROM public.trip_events WHERE company_id = $1`, [companyId]);
      await pool.query(`ALTER TABLE public.trip_events ENABLE TRIGGER trip_events_append_only`);
      await pool.query(`DELETE FROM public.trips WHERE company_id = $1`, [companyId]);
      await pool.query(`DELETE FROM public.routes WHERE company_id = $1`, [companyId]);
      await pool.query(`DELETE FROM public.buses WHERE company_id = $1`, [companyId]);
      await pool.query(`DELETE FROM public.seat_layouts WHERE id = $1`, [layout]);
      await pool.query(`DELETE FROM public.stations WHERE city_id = $1`, [city]);
      await pool.query(`DELETE FROM public.cities WHERE id = $1`, [city]);
      await pool.query(`DELETE FROM public.company_settings WHERE company_id = $1`, [companyId]);
      await pool.query(`DELETE FROM public.companies WHERE id = $1`, [companyId]);
      await pool.query(`DELETE FROM auth.users WHERE id = $1`, [owner]);
    }
  });
});
