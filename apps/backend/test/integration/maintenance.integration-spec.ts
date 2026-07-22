import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AuditWriter } from '../../src/modules/audit/audit.service';
import { PostgresAuditRepository } from '../../src/modules/audit/postgres-audit.repository';
import { BusStatus } from '../../src/modules/buses/bus-status';
import { DatabaseService } from '../../src/infrastructure/database';
import { DatabaseErrorMapper } from '../../src/infrastructure/database/database-error.mapper';
import {
  Transaction,
  TransactionManager,
} from '../../src/infrastructure/database/transaction.manager';
import { MaintenanceConflictError } from '../../src/modules/maintenance/maintenance.errors';
import { PostgresMaintenanceRepository } from '../../src/modules/maintenance/postgres-maintenance.repository';
import { MaintenanceService } from '../../src/modules/maintenance/maintenance.service';
import { MaintenanceStatus } from '../../src/modules/maintenance/maintenance-status';
import { MaintenanceAction } from '../../src/modules/maintenance/maintenance-transitions';
import { MaintenanceType } from '../../src/modules/maintenance/maintenance-type';
import { PostgresTripEventsRepository } from '../../src/modules/trips/postgres-trip-events.repository';
import { PostgresTripsRepository } from '../../src/modules/trips/postgres-trips.repository';
import { TripsService } from '../../src/modules/trips/trips.service';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const MAINTENANCE_START = new Date('2026-03-01T08:00:00.000Z');
const MAINTENANCE_END = new Date('2026-03-01T10:00:00.000Z');
const TRIP_END = new Date('2026-03-01T12:00:00.000Z');

interface Seed {
  user: string;
  companyId: string;
  busId: string;
  routeId: string;
}

describe('Maintenance domain (integration)', () => {
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
      console.warn(`[integration] No database at ${DATABASE_URL} - skipping maintenance assertions.`);
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
    const suffix = user.slice(0, 8);
    await tx.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
      user,
      `${user}@itest.local`,
    ]);
    const companyId = await scalar(
      tx,
      `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`,
      [`Maint-${suffix}`],
    );
    const city = await scalar(
      tx,
      `INSERT INTO public.cities (name_ar, name_fr) VALUES ($1, $2) RETURNING id`,
      [`M-${suffix}`, `M-${suffix}`],
    );
    const origin = await scalar(
      tx,
      `INSERT INTO public.stations (city_id, name_ar, name_fr) VALUES ($1, $2, $3) RETURNING id`,
      [city, `O-${suffix}`, `O-${suffix}`],
    );
    const destination = await scalar(
      tx,
      `INSERT INTO public.stations (city_id, name_ar, name_fr) VALUES ($1, $2, $3) RETURNING id`,
      [city, `D-${suffix}`, `D-${suffix}`],
    );
    const layout = await scalar(
      tx,
      `INSERT INTO public.seat_layouts (name, total_seats, layout_grid)
       VALUES ($1, 2, '["1","2"]'::jsonb) RETURNING id`,
      [`Layout-${suffix}`],
    );
    const busId = await scalar(
      tx,
      `INSERT INTO public.buses (company_id, seat_layout_id, plate_number)
       VALUES ($1, $2, $3) RETURNING id`,
      [companyId, layout, `M-${suffix}`],
    );
    const routeId = await scalar(
      tx,
      `INSERT INTO public.routes (
         company_id, origin_station_id, destination_station_id,
         default_price_mru, estimated_duration_minutes
       ) VALUES ($1, $2, $3, 500, 240) RETURNING id`,
      [companyId, origin, destination],
    );
    await tx.query(
      `INSERT INTO public.company_memberships (user_id, company_id, role)
       VALUES ($1, $2, 'COMPANY_MANAGER')`,
      [user, companyId],
    );
    return { user, companyId, busId, routeId };
  }

  function build(tx: Transaction): {
    maintenance: MaintenanceService;
    repository: PostgresMaintenanceRepository;
    trips: TripsService;
  } {
    let savepoint = 0;
    const txManager = {
      run: async <T>(work: (transaction: Transaction) => Promise<T>): Promise<T> => {
        const name = `sp_${++savepoint}`;
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
    const repository = new PostgresMaintenanceRepository();
    const maintenance = new MaintenanceService(
      repository,
      tx as unknown as DatabaseService,
      txManager,
      new AuditWriter(new PostgresAuditRepository()),
    );
    return {
      maintenance,
      repository,
      trips: new TripsService(
        new PostgresTripsRepository(),
        new PostgresTripEventsRepository(),
        tx as unknown as DatabaseService,
        txManager,
        maintenance,
      ),
    };
  }

  function create(busId: string) {
    return {
      busId,
      maintenanceType: MaintenanceType.Inspection,
      startedAt: MAINTENANCE_START,
      scheduledEndsAt: MAINTENANCE_END,
    };
  }

  async function busStatus(tx: Transaction, busId: string): Promise<string> {
    const result = await tx.query<{ status: string }>(
      `SELECT status FROM public.buses WHERE id = $1`,
      [busId],
    );
    return result.rows[0].status;
  }

  it('creates a scheduled record with its planned end', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { maintenance } = build(tx);

      const record = await maintenance.createRecord(s.companyId, create(s.busId), s.user);

      expect(record).toMatchObject({
        companyId: s.companyId,
        busId: s.busId,
        status: MaintenanceStatus.Scheduled,
      });
      expect(record.scheduledEndsAt?.toISOString()).toBe(MAINTENANCE_END.toISOString());
    });
  });

  it('rejects a duplicate active maintenance record for a bus', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { maintenance } = build(tx);
      await maintenance.createRecord(s.companyId, create(s.busId), s.user);

      await expect(
        maintenance.createRecord(s.companyId, create(s.busId), s.user),
      ).rejects.toBeInstanceOf(MaintenanceConflictError);
    });
  });

  it('keeps scheduled windows half-open and makes in-progress maintenance unbounded', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { maintenance, repository, trips } = build(tx);
      const record = await maintenance.createRecord(s.companyId, create(s.busId), s.user);

      expect(
        await repository.hasActiveMaintenanceOverlap(
          tx, s.companyId, s.busId, MAINTENANCE_END, TRIP_END,
        ),
      ).toBe(false);
      expect(
        await maintenance.hasActiveMaintenanceOverlap(
          tx, s.companyId, s.busId, MAINTENANCE_END, TRIP_END,
        ),
      ).toBe(false);
      await expect(
        trips.createTrip(s.companyId, {
          routeId: s.routeId,
          busId: s.busId,
          departureTime: MAINTENANCE_END,
          estimatedArrivalTime: TRIP_END,
        }, s.user),
      ).resolves.toMatchObject({ busId: s.busId });

      const started = await maintenance.applyAction(
        s.companyId, record.id, MaintenanceAction.Start, s.user,
      );
      expect(started.status).toBe(MaintenanceStatus.InProgress);
      expect(await busStatus(tx, s.busId)).toBe(BusStatus.InMaintenance);
      expect(
        await repository.hasActiveMaintenanceOverlap(
          tx, s.companyId, s.busId, MAINTENANCE_END, TRIP_END,
        ),
      ).toBe(true);
      expect(
        await maintenance.hasActiveMaintenanceOverlap(
          tx, s.companyId, s.busId, MAINTENANCE_END, TRIP_END,
        ),
      ).toBe(true);
    });
  });

  it('restores an in-maintenance bus to active when maintenance completes', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { maintenance } = build(tx);
      const record = await maintenance.createRecord(s.companyId, create(s.busId), s.user);
      await maintenance.applyAction(s.companyId, record.id, MaintenanceAction.Start, s.user);

      const completed = await maintenance.applyAction(
        s.companyId, record.id, MaintenanceAction.Complete, s.user,
      );

      expect(completed.status).toBe(MaintenanceStatus.Completed);
      expect(completed.completedAt).toBeInstanceOf(Date);
      expect(await busStatus(tx, s.busId)).toBe(BusStatus.Active);
    });
  });

  it('does not restore an out-of-service bus when maintenance completes', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { maintenance } = build(tx);
      const record = await maintenance.createRecord(s.companyId, create(s.busId), s.user);
      await maintenance.applyAction(s.companyId, record.id, MaintenanceAction.Start, s.user);
      await tx.query(
        `UPDATE public.buses SET status = 'OUT_OF_SERVICE' WHERE id = $1`,
        [s.busId],
      );

      await maintenance.applyAction(s.companyId, record.id, MaintenanceAction.Complete, s.user);

      expect(await busStatus(tx, s.busId)).toBe(BusStatus.OutOfService);
    });
  });

  it('rejects an illegal lifecycle transition', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      const { maintenance } = build(tx);
      const record = await maintenance.createRecord(s.companyId, create(s.busId), s.user);

      await expect(
        maintenance.applyAction(s.companyId, record.id, MaintenanceAction.Complete, s.user),
      ).rejects.toBeInstanceOf(MaintenanceConflictError);
    });
  });

  it('denies direct authenticated maintenance inserts', async () => {
    if (!available) return;
    await inRollback(async (tx) => {
      const s = await seed(tx);
      await tx.query(`SAVEPOINT direct_authenticated_insert`);
      await tx.query(`SET LOCAL role authenticated`);
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: s.user, role: 'authenticated' }),
      ]);

      await expect(
        tx.query(
          `INSERT INTO public.vehicle_maintenance_records (
             bus_id, company_id, maintenance_type, started_at, scheduled_ends_at
           ) VALUES ($1, $2, 'INSPECTION', $3, $4)`,
          [s.busId, s.companyId, MAINTENANCE_START, MAINTENANCE_END],
        ),
      ).rejects.toMatchObject({
        dbErrorCode: 'UNKNOWN',
        driverError: { code: '42501' },
      });

      await tx.query(`ROLLBACK TO SAVEPOINT direct_authenticated_insert`);
      await tx.query(`RESET role`);
    });
  });
});
