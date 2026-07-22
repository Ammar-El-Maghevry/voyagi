import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient } from 'pg';
import { resolvePagination } from '../../src/common/pagination/pagination';
import { DatabaseService } from '../../src/infrastructure/database';
import { DatabaseErrorMapper } from '../../src/infrastructure/database/database-error.mapper';
import type { DatabaseExecutor } from '../../src/infrastructure/database/database.types';
import {
  Transaction,
  TransactionManager,
} from '../../src/infrastructure/database/transaction.manager';
import { PostgresAvailabilityRepository } from '../../src/modules/availability/postgres-availability.repository';
import {
  BookingNotCancellableError,
  IdempotencyConflictError,
  InvalidSeatSelectionError,
  TripNotBookableError,
} from '../../src/modules/bookings/booking.errors';
import { ExpireBookingUseCase } from '../../src/modules/bookings/booking.use-cases';
import { PassengerGender } from '../../src/modules/bookings/booking.types';
import type { IdempotencyClaim } from '../../src/modules/bookings/booking.types';
import { BookingsService } from '../../src/modules/bookings/bookings.service';
import { PostgresBookingsRepository } from '../../src/modules/bookings/postgres-bookings.repository';
import { PostgresTripsRepository } from '../../src/modules/trips/postgres-trips.repository';
import { TripStatus } from '../../src/modules/trips/trip-status';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const databaseConfig = {
  get: () => ({ logQueries: false, slowQueryMs: 1_000 }),
} as unknown as ConfigService;

interface Seed {
  owner: string;
  otherOwner: string;
  manager: string;
  outsider: string;
  companyA: string;
  companyB: string;
  branchA: string;
  branchB: string;
  branchCompanyB: string;
  tripA: string;
  tripB: string;
  city: string;
  stations: readonly string[];
  layout: string;
}

interface CommittedSeed extends Seed {
  readonly userIds: readonly string[];
}

class TwoPartyGate {
  private arrivals = 0;
  private release!: () => void;
  private readonly promise = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  arrive(): Promise<void> {
    this.arrivals += 1;
    if (this.arrivals === 2) this.release();
    return this.promise;
  }
}

class Deferred {
  readonly promise: Promise<void>;
  resolve!: () => void;

  constructor() {
    this.promise = new Promise<void>((resolve) => {
      this.resolve = resolve;
    });
  }
}

class NamedTripLockRepository extends PostgresBookingsRepository {
  constructor(private readonly applicationName: string) {
    super();
  }

  override async findTripForBooking(
    executor: DatabaseExecutor,
    tripId: string,
    companyId?: string,
  ) {
    await executor.query(`SELECT set_config('application_name', $1, true)`, [
      this.applicationName,
    ]);
    return super.findTripForBooking(executor, tripId, companyId);
  }
}

class PausingTripLockRepository extends NamedTripLockRepository {
  constructor(
    applicationName: string,
    private readonly locked: Deferred,
    private readonly release: Deferred,
  ) {
    super(applicationName);
  }

  override async findTripForBooking(
    executor: DatabaseExecutor,
    tripId: string,
    companyId?: string,
  ) {
    const trip = await super.findTripForBooking(executor, tripId, companyId);
    this.locked.resolve();
    await this.release.promise;
    return trip;
  }
}

class NamedCancellationRepository extends PostgresBookingsRepository {
  constructor(
    private readonly applicationName: string,
    private readonly locked?: Deferred,
    private readonly release?: Deferred,
  ) {
    super();
  }

  override async lockOwnedBookingForCancellation(
    executor: DatabaseExecutor,
    ownerUserId: string,
    bookingId: string,
  ): Promise<boolean> {
    await executor.query(`SELECT set_config('application_name', $1, true)`, [
      this.applicationName,
    ]);
    const visible = await super.lockOwnedBookingForCancellation(
      executor,
      ownerUserId,
      bookingId,
    );
    this.locked?.resolve();
    if (this.release) await this.release.promise;
    return visible;
  }
}

class SimultaneousExpirationRepository extends PostgresBookingsRepository {
  constructor(private readonly gate: TwoPartyGate) {
    super();
  }

  override async releaseExpired(
    executor: DatabaseExecutor,
    companyId: string,
    tripId?: string,
  ) {
    await this.gate.arrive();
    return super.releaseExpired(executor, companyId, tripId);
  }
}

class SimultaneousClaimRepository extends PostgresBookingsRepository {
  private readonly gate = new TwoPartyGate();

  override async claimIdempotency(
    executor: DatabaseExecutor,
    companyId: string,
    actorUserId: string,
    operation: string,
    key: string,
    fingerprint: string,
  ): Promise<IdempotencyClaim> {
    await this.gate.arrive();
    return super.claimIdempotency(
      executor,
      companyId,
      actorUserId,
      operation,
      key,
      fingerprint,
    );
  }
}

class SimultaneousSeatRepository extends PostgresBookingsRepository {
  private readonly gate = new TwoPartyGate();

  override async insertSeat(
    executor: DatabaseExecutor,
    tripId: string,
    bookingId: string,
    passengerId: string,
    seatId: string,
  ): Promise<void> {
    await this.gate.arrive();
    return super.insertSeat(executor, tripId, bookingId, passengerId, seatId);
  }
}

describe('Booking engine (PostgreSQL integration)', () => {
  let pool: Pool;
  let transactions: TransactionManager;
  let database: DatabaseService;
  let available = false;
  let committed: CommittedSeed | undefined;

  beforeAll(async () => {
    const databaseHost = new URL(DATABASE_URL).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(databaseHost)) {
      throw new Error('Booking integration cleanup requires a disposable local PostgreSQL database.');
    }
    pool = new Pool({ connectionString: DATABASE_URL, max: 8 });
    pool.on('error', () => undefined);
    const mapper = new DatabaseErrorMapper();
    transactions = new TransactionManager(pool, mapper);
    database = new DatabaseService(pool, mapper, databaseConfig);

    try {
      await pool.query('SELECT 1');
      available = true;
    } catch (error) {
      throw new Error(
        `Booking integration tests require PostgreSQL at ${DATABASE_URL}.`,
        { cause: error },
      );
    }

    const schema = await pool.query<{ migration_015: string | null }>(
      `SELECT to_regclass('public.idempotency_records')::text AS migration_015`,
    );
    if (!schema.rows[0]?.migration_015) {
      throw new Error(
        'PostgreSQL is reachable, but migration 015 is not applied (public.idempotency_records is missing).',
      );
    }

    const committedSeed = await transactions.run((tx) => seed(tx));
    committed = {
      ...committedSeed,
      userIds: [
        committedSeed.owner,
        committedSeed.otherOwner,
        committedSeed.manager,
        committedSeed.outsider,
      ],
    };
  });

  afterAll(async () => {
    if (committed) await cleanupCommitted(committed);
    await pool.end();
  });

  async function scalar(
    executor: DatabaseExecutor,
    text: string,
    params: readonly unknown[],
  ): Promise<string> {
    const result = await executor.query<{ id: string }>(text, params);
    return String(result.rows[0].id);
  }

  async function seed(executor: DatabaseExecutor): Promise<Seed> {
    const owner = randomUUID();
    const otherOwner = randomUUID();
    const manager = randomUUID();
    const outsider = randomUUID();
    const users = [owner, otherOwner, manager, outsider];
    for (const user of users) {
      await executor.query(
        `INSERT INTO auth.users (id, email, raw_user_meta_data)
         VALUES ($1, $2, jsonb_build_object('full_name', $3::text))`,
        [user, `${user}@booking-itest.local`, `User ${user.slice(0, 8)}`],
      );
    }

    const suffix = owner.slice(0, 8);
    const companyA = await scalar(
      executor,
      `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`,
      [`Booking A ${suffix}`],
    );
    const companyB = await scalar(
      executor,
      `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`,
      [`Booking B ${suffix}`],
    );
    const city = await scalar(
      executor,
      `INSERT INTO public.cities (name_ar, name_fr) VALUES ($1, $2) RETURNING id`,
      [`مدينة-${suffix}`, `BookingCity-${suffix}`],
    );
    const origin = await scalar(
      executor,
      `INSERT INTO public.stations (city_id, name_ar, name_fr)
       VALUES ($1, $2, $3) RETURNING id`,
      [city, `أصل-${suffix}`, `Origin-${suffix}`],
    );
    const destination = await scalar(
      executor,
      `INSERT INTO public.stations (city_id, name_ar, name_fr)
       VALUES ($1, $2, $3) RETURNING id`,
      [city, `وجهة-${suffix}`, `Destination-${suffix}`],
    );
    const branchA = await scalar(
      executor,
      `INSERT INTO public.branches (company_id, city_id, name_ar, name_fr)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [companyA, city, `فرع-أ-${suffix}`, `Branch-A-${suffix}`],
    );
    const branchB = await scalar(
      executor,
      `INSERT INTO public.branches (company_id, city_id, name_ar, name_fr)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [companyA, city, `فرع-ب-${suffix}`, `Branch-B-${suffix}`],
    );
    const branchCompanyB = await scalar(
      executor,
      `INSERT INTO public.branches (company_id, city_id, name_ar, name_fr)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [companyB, city, `فرع-ج-${suffix}`, `Branch-C-${suffix}`],
    );
    const layout = await scalar(
      executor,
      `INSERT INTO public.seat_layouts (name, total_seats, layout_grid)
       VALUES ($1, 4, '["1A", "1B", "2A", "2B"]'::jsonb) RETURNING id`,
      [`Booking layout ${suffix}`],
    );
    const routeA = await scalar(
      executor,
      `INSERT INTO public.routes
         (company_id, origin_station_id, destination_station_id,
          default_price_mru, estimated_duration_minutes)
       VALUES ($1, $2, $3, 500, 180) RETURNING id`,
      [companyA, origin, destination],
    );
    const routeB = await scalar(
      executor,
      `INSERT INTO public.routes
         (company_id, origin_station_id, destination_station_id,
          default_price_mru, estimated_duration_minutes)
       VALUES ($1, $2, $3, 900, 180) RETURNING id`,
      [companyB, destination, origin],
    );
    const busA = await scalar(
      executor,
      `INSERT INTO public.buses (company_id, seat_layout_id, plate_number)
       VALUES ($1, $2, $3) RETURNING id`,
      [companyA, layout, `BOOK-A-${suffix}`],
    );
    const busB = await scalar(
      executor,
      `INSERT INTO public.buses (company_id, seat_layout_id, plate_number)
       VALUES ($1, $2, $3) RETURNING id`,
      [companyB, layout, `BOOK-B-${suffix}`],
    );
    const tripA = await scalar(
      executor,
      `INSERT INTO public.trips
         (company_id, route_id, bus_id, departure_time,
          estimated_arrival_time, price_mru, boarding_closes_at)
       VALUES ($1, $2, $3, now() + interval '2 days',
               now() + interval '2 days 3 hours', 500,
               now() + interval '1 day 23 hours')
       RETURNING id`,
      [companyA, routeA, busA],
    );
    const tripB = await scalar(
      executor,
      `INSERT INTO public.trips
         (company_id, route_id, bus_id, departure_time,
          estimated_arrival_time, price_mru, boarding_closes_at)
       VALUES ($1, $2, $3, now() + interval '3 days',
               now() + interval '3 days 3 hours', 900,
               now() + interval '2 days 23 hours')
       RETURNING id`,
      [companyB, routeB, busB],
    );

    await executor.query(
      `INSERT INTO public.company_memberships (user_id, company_id, role)
       VALUES ($1, $2, 'COMPANY_MANAGER'),
              ($1, $3, 'COMPANY_MANAGER'),
              ($4, $3, 'COMPANY_MANAGER')`,
      [manager, companyA, companyB, outsider],
    );

    return {
      owner,
      otherOwner,
      manager,
      outsider,
      companyA,
      companyB,
      branchA,
      branchB,
      branchCompanyB,
      tripA,
      tripB,
      city,
      stations: [origin, destination],
      layout,
    };
  }

  async function inRollback(
    work: (
      tx: Transaction,
      fixture: Seed,
      service: BookingsService,
    ) => Promise<void>,
  ): Promise<void> {
    const sentinel = new Error('rollback-sentinel');
    try {
      await transactions.run(async (tx) => {
        const fixture = await seed(tx);
        await work(tx, fixture, buildSavepointService(tx));
        throw sentinel;
      });
    } catch (error) {
      if (error !== sentinel) throw error;
    }
  }

  async function withCommittedSeed(
    work: (fixture: CommittedSeed) => Promise<void>,
  ): Promise<void> {
    const fixture = await transactions.run(async (tx) => {
      const created = await seed(tx);
      return {
        ...created,
        userIds: [
          created.owner,
          created.otherOwner,
          created.manager,
          created.outsider,
        ],
      };
    });
    try {
      await work(fixture);
    } finally {
      await cleanupCommitted(fixture);
    }
  }

  function buildSavepointService(tx: Transaction): BookingsService {
    let savepoint = 0;
    const nested = {
      run: async <T>(
        work: (executor: Transaction) => Promise<T>,
      ): Promise<T> => {
        const name = `booking_sp_${++savepoint}`;
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
    return new BookingsService(
      new PostgresBookingsRepository(),
      tx as unknown as DatabaseService,
      nested,
    );
  }

  function passenger(
    seatId: string,
    fullName = 'Private Passenger',
    gender = PassengerGender.Female,
  ) {
    return {
      fullName,
      phone: '+22236000000',
      documentNumber: `DOC-${seatId}`,
      gender,
      seatId,
    };
  }

  async function rowCount(
    executor: DatabaseExecutor,
    text: string,
    params: readonly unknown[],
  ): Promise<number> {
    const result = await executor.query<{ count: string }>(text, params);
    return Number(result.rows[0].count);
  }

  async function setAuthenticated(
    tx: Transaction,
    userId: string,
  ): Promise<void> {
    await tx.query(`SET LOCAL role authenticated`);
    await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
  }

  async function expectPermissionDenied(
    tx: Transaction,
    sql: string,
  ): Promise<void> {
    const savepoint = `denied_${randomUUID().replaceAll('-', '')}`;
    await tx.query(`SAVEPOINT ${savepoint}`);
    let failure: unknown;
    try {
      await tx.query(sql);
    } catch (error) {
      failure = error;
    }
    await tx.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    const driverError = (
      failure as { driverError?: { code?: string } } | undefined
    )?.driverError;
    expect(driverError?.code).toBe('42501');
  }

  async function waitForLockWait(applicationName: string): Promise<void> {
    // Fail before Jest's timeout so fixture finally blocks can always clean up.
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const result = await pool.query<{ wait_event_type: string | null }>(
        `SELECT wait_event_type
           FROM pg_stat_activity
          WHERE application_name = $1 AND state = 'active'`,
        [applicationName],
      );
      if (result.rows.some((row) => row.wait_event_type === 'Lock')) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`${applicationName} did not reach a PostgreSQL lock wait`);
  }

  async function settleDefined(
    promises: readonly (Promise<unknown> | undefined)[],
  ): Promise<void> {
    await Promise.allSettled(
      promises.filter(
        (promise): promise is Promise<unknown> => promise !== undefined,
      ),
    );
  }

  async function conditionalCheckIn(
    client: PoolClient,
    bookingId: string,
    applicationName: string,
    locked?: Deferred,
    release?: Deferred,
  ): Promise<number> {
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('application_name', $1, true)`, [
        applicationName,
      ]);
      await client.query(
        `SELECT id FROM public.bookings WHERE id = $1 FOR UPDATE`,
        [bookingId],
      );
      locked?.resolve();
      if (release) await release.promise;
      const result = await client.query(
        `UPDATE public.seat_reservations seat
            SET status = 'CHECKED_IN', updated_at = now()
          WHERE seat.booking_id = $1 AND seat.status = 'CONFIRMED'
            AND EXISTS (
              SELECT 1 FROM public.bookings booking
               WHERE booking.id = seat.booking_id
                 AND booking.status IN ('HELD', 'PENDING_PAYMENT')
            )`,
        [bookingId],
      );
      await client.query('COMMIT');
      return result.rowCount ?? 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function cleanupCommitted(fixture: CommittedSeed): Promise<void> {
    let eventsTriggerDisabled = false;
    let bookingsTriggerDisabled = false;
    try {
      await pool.query(
        `ALTER TABLE public.booking_events DISABLE TRIGGER booking_events_append_only`,
      );
      eventsTriggerDisabled = true;
      await pool.query(
        `ALTER TABLE public.bookings DISABLE TRIGGER bookings_no_delete`,
      );
      bookingsTriggerDisabled = true;
      await pool.query(
        `DELETE FROM public.booking_events WHERE company_id IN ($1, $2)`,
        [fixture.companyA, fixture.companyB],
      );
      await pool.query(
        `DELETE FROM public.idempotency_records WHERE company_id IN ($1, $2)`,
        [fixture.companyA, fixture.companyB],
      );
      await pool.query(
        `DELETE FROM public.seat_reservations
         WHERE trip_id IN ($1, $2)`,
        [fixture.tripA, fixture.tripB],
      );
      await pool.query(
        `DELETE FROM public.passengers
         WHERE booking_id IN (
           SELECT id FROM public.bookings WHERE company_id IN ($1, $2)
         )`,
        [fixture.companyA, fixture.companyB],
      );
      await pool.query(
        `DELETE FROM public.bookings WHERE company_id IN ($1, $2)`,
        [fixture.companyA, fixture.companyB],
      );
    } finally {
      if (bookingsTriggerDisabled) {
        await pool.query(
          `ALTER TABLE public.bookings ENABLE TRIGGER bookings_no_delete`,
        );
      }
      if (eventsTriggerDisabled) {
        await pool.query(
          `ALTER TABLE public.booking_events ENABLE TRIGGER booking_events_append_only`,
        );
      }
    }

    await pool.query(`DELETE FROM public.trips WHERE id IN ($1, $2)`, [
      fixture.tripA,
      fixture.tripB,
    ]);
    await pool.query(
      `DELETE FROM public.company_memberships WHERE company_id IN ($1, $2)`,
      [fixture.companyA, fixture.companyB],
    );
    await pool.query(
      `DELETE FROM public.branches WHERE company_id IN ($1, $2)`,
      [fixture.companyA, fixture.companyB],
    );
    await pool.query(`DELETE FROM public.routes WHERE company_id IN ($1, $2)`, [
      fixture.companyA,
      fixture.companyB,
    ]);
    await pool.query(`DELETE FROM public.buses WHERE company_id IN ($1, $2)`, [
      fixture.companyA,
      fixture.companyB,
    ]);
    await pool.query(
      `DELETE FROM public.company_settings WHERE company_id IN ($1, $2)`,
      [fixture.companyA, fixture.companyB],
    );
    await pool.query(`DELETE FROM public.companies WHERE id IN ($1, $2)`, [
      fixture.companyA,
      fixture.companyB,
    ]);
    await pool.query(`DELETE FROM public.seat_layouts WHERE id = $1`, [
      fixture.layout,
    ]);
    await pool.query(`DELETE FROM public.stations WHERE city_id = $1`, [
      fixture.city,
    ]);
    await pool.query(`DELETE FROM public.cities WHERE id = $1`, [fixture.city]);
    await pool.query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [
      fixture.userIds,
    ]);
  }

  it('creates booking, passengers, seats, event, and completed idempotency atomically', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      const booking = await service.createPassengerBooking(
        fixture.owner,
        'atomic-create',
        {
          tripId: fixture.tripA,
          passengers: [
            passenger('1A', 'Atomic One', PassengerGender.Female),
            passenger('1B', 'Atomic Two', PassengerGender.Male),
          ],
        },
      );

      expect(booking).toMatchObject({
        tripId: fixture.tripA,
        companyId: fixture.companyA,
        bookedByUserId: fixture.owner,
        status: 'HELD',
        unitPrice: '500.00',
        subtotalAmount: '1000.00',
        totalAmount: '1000.00',
      });
      expect(booking.passengers.map((item) => item.seatId)).toEqual([
        '1A',
        '1B',
      ]);
      await expect(
        rowCount(tx, `SELECT count(*) FROM public.bookings WHERE id = $1`, [
          booking.id,
        ]),
      ).resolves.toBe(1);
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.passengers WHERE booking_id = $1`,
          [booking.id],
        ),
      ).resolves.toBe(2);
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.seat_reservations WHERE booking_id = $1`,
          [booking.id],
        ),
      ).resolves.toBe(2);
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.booking_events WHERE booking_id = $1`,
          [booking.id],
        ),
      ).resolves.toBe(1);
      const idempotency = await tx.query<{
        booking_id: string;
        response_status: number;
        completed_at: Date;
      }>(
        `SELECT booking_id, response_status, completed_at
         FROM public.idempotency_records
         WHERE idempotency_key = 'atomic-create'`,
      );
      expect(idempotency.rows[0]).toMatchObject({
        booking_id: booking.id,
        response_status: 201,
      });
      expect(idempotency.rows[0].completed_at).toBeInstanceOf(Date);
    });
  });

  it('returns one booking for an identical DB-backed idempotency replay', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      const input = { tripId: fixture.tripA, passengers: [passenger('1A')] };
      const first = await service.createPassengerBooking(
        fixture.owner,
        'same-request',
        input,
      );
      await tx.query(
        `UPDATE public.buses
            SET is_active = false
          WHERE id = (SELECT bus_id FROM public.trips WHERE id = $1)`,
        [fixture.tripA],
      );
      const replay = await service.createPassengerBooking(
        fixture.owner,
        'same-request',
        input,
      );

      expect(replay.id).toBe(first.id);
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.bookings
           WHERE trip_id = $1 AND booked_by_user_id = $2`,
          [fixture.tripA, fixture.owner],
        ),
      ).resolves.toBe(1);
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.idempotency_records
           WHERE company_id = $1 AND actor_user_id = $2
             AND idempotency_key = 'same-request' AND completed_at IS NOT NULL`,
          [fixture.companyA, fixture.owner],
        ),
      ).resolves.toBe(1);
    });
  });

  it('replays a canonically identical payload with reordered object fields in PostgreSQL', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      const first = await service.createPassengerBooking(
        fixture.owner,
        'canonical-db-replay',
        {
          tripId: fixture.tripA,
          passengers: [
            {
              fullName: 'Canonical Passenger',
              phone: '+22236111111',
              documentNumber: 'CANONICAL-DOC',
              gender: PassengerGender.Female,
              seatId: '1A',
            },
          ],
        },
      );
      const replay = await service.createPassengerBooking(
        fixture.owner,
        'canonical-db-replay',
        {
          passengers: [
            {
              seatId: '1A',
              gender: PassengerGender.Female,
              documentNumber: 'CANONICAL-DOC',
              phone: '+22236111111',
              fullName: 'Canonical Passenger',
            },
          ],
          tripId: fixture.tripA,
        },
      );

      expect(replay.id).toBe(first.id);
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.idempotency_records
            WHERE actor_user_id = $1 AND idempotency_key = $2
              AND completed_at IS NOT NULL`,
          [fixture.owner, 'canonical-db-replay'],
        ),
      ).resolves.toBe(1);
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.bookings
            WHERE booked_by_user_id = $1 AND trip_id = $2`,
          [fixture.owner, fixture.tripA],
        ),
      ).resolves.toBe(1);
    });
  });

  it('scopes one idempotency key independently by actor, operation, and company', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      const key = 'same-key-all-scopes';
      const passengerBooking = await service.createPassengerBooking(
        fixture.manager,
        key,
        { tripId: fixture.tripA, passengers: [passenger('1A')] },
      );
      const agent = await service.createAgentBooking(
        fixture.manager,
        fixture.companyA,
        fixture.branchA,
        key,
        { tripId: fixture.tripA, passengers: [passenger('1B')] },
      );
      const otherActor = await service.createPassengerBooking(
        fixture.owner,
        key,
        { tripId: fixture.tripA, passengers: [passenger('2A')] },
      );
      const otherCompany = await service.createAgentBooking(
        fixture.manager,
        fixture.companyB,
        fixture.branchCompanyB,
        key,
        { tripId: fixture.tripB, passengers: [passenger('1A')] },
      );

      expect(
        new Set([passengerBooking.id, agent.id, otherActor.id, otherCompany.id])
          .size,
      ).toBe(4);
      const records = await tx.query<{
        company_id: string;
        actor_user_id: string;
        operation: string;
      }>(
        `SELECT company_id::text, actor_user_id, operation
           FROM public.idempotency_records
          WHERE idempotency_key = $1
          ORDER BY company_id, actor_user_id, operation`,
        [key],
      );
      expect(records.rows).toHaveLength(4);
      expect(
        new Set(
          records.rows.map(
            (row) => `${row.company_id}:${row.actor_user_id}:${row.operation}`,
          ),
        ).size,
      ).toBe(4);
      expect(records.rows.map((row) => row.operation).sort()).toEqual([
        'CREATE_AGENT_BOOKING',
        'CREATE_AGENT_BOOKING',
        'CREATE_PASSENGER_BOOKING',
        'CREATE_PASSENGER_BOOKING',
      ]);
    });
  });

  it('rejects the same idempotency key with a different fingerprint', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      await service.createPassengerBooking(fixture.owner, 'changed-request', {
        tripId: fixture.tripA,
        passengers: [passenger('1A')],
      });
      await expect(
        service.createPassengerBooking(fixture.owner, 'changed-request', {
          tripId: fixture.tripA,
          passengers: [passenger('1B')],
        }),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.bookings WHERE trip_id = $1`,
          [fixture.tripA],
        ),
      ).resolves.toBe(1);
    });
  });

  it('reclaims an expired idempotency key for a new request', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      const first = await service.createPassengerBooking(
        fixture.owner,
        'expired-reuse',
        { tripId: fixture.tripA, passengers: [passenger('1A')] },
      );
      await service.cancelOwnedBooking(fixture.owner, first.id);
      await tx.query(
        `UPDATE public.idempotency_records
            SET expires_at = now() - interval '1 second'
          WHERE company_id = $1 AND actor_user_id = $2
            AND operation = 'CREATE_PASSENGER_BOOKING'
            AND idempotency_key = 'expired-reuse'`,
        [fixture.companyA, fixture.owner],
      );

      const replacement = await service.createPassengerBooking(
        fixture.owner,
        'expired-reuse',
        { tripId: fixture.tripA, passengers: [passenger('1B')] },
      );

      expect(replacement.id).not.toBe(first.id);
      const record = await tx.query<{ booking_id: string; completed_at: Date }>(
        `SELECT booking_id, completed_at
           FROM public.idempotency_records
          WHERE company_id = $1 AND actor_user_id = $2
            AND operation = 'CREATE_PASSENGER_BOOKING'
            AND idempotency_key = 'expired-reuse'`,
        [fixture.companyA, fixture.owner],
      );
      expect(record.rows).toHaveLength(1);
      expect(record.rows[0]).toMatchObject({ booking_id: replacement.id });
      expect(record.rows[0].completed_at).toBeInstanceOf(Date);
    });
  });

  it('rolls back a failed expired-key reclamation without a false new success', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      const original = await service.createPassengerBooking(
        fixture.owner,
        'expired-rollback',
        { tripId: fixture.tripA, passengers: [passenger('1A')] },
      );
      await service.cancelOwnedBooking(fixture.owner, original.id);
      await tx.query(
        `UPDATE public.idempotency_records
            SET expires_at = now() - interval '1 second'
          WHERE company_id = $1 AND actor_user_id = $2
            AND operation = 'CREATE_PASSENGER_BOOKING'
            AND idempotency_key = 'expired-rollback'`,
        [fixture.companyA, fixture.owner],
      );

      await expect(
        service.createPassengerBooking(fixture.owner, 'expired-rollback', {
          tripId: fixture.tripA,
          passengers: [passenger('not-in-layout')],
        }),
      ).rejects.toBeInstanceOf(InvalidSeatSelectionError);

      const record = await tx.query<{ booking_id: string; completed_at: Date }>(
        `SELECT booking_id, completed_at
           FROM public.idempotency_records
          WHERE company_id = $1 AND actor_user_id = $2
            AND operation = 'CREATE_PASSENGER_BOOKING'
            AND idempotency_key = 'expired-rollback'`,
        [fixture.companyA, fixture.owner],
      );
      expect(record.rows).toHaveLength(1);
      expect(record.rows[0]).toMatchObject({ booking_id: original.id });
      expect(record.rows[0].completed_at).toBeInstanceOf(Date);
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.bookings
            WHERE trip_id = $1 AND booked_by_user_id = $2 AND id <> $3`,
          [fixture.tripA, fixture.owner, original.id],
        ),
      ).resolves.toBe(0);
    });
  });

  it('rolls back idempotency, booking, passenger, seat, and event rows on failure', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      await expect(
        service.createPassengerBooking(fixture.owner, 'failed-create', {
          tripId: fixture.tripA,
          passengers: [passenger('not-in-layout')],
        }),
      ).rejects.toBeInstanceOf(InvalidSeatSelectionError);

      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.idempotency_records
           WHERE actor_user_id = $1 AND idempotency_key = 'failed-create'`,
          [fixture.owner],
        ),
      ).resolves.toBe(0);
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.bookings
           WHERE trip_id = $1 AND booked_by_user_id = $2`,
          [fixture.tripA, fixture.owner],
        ),
      ).resolves.toBe(0);
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.passengers passenger
           JOIN public.bookings booking ON booking.id = passenger.booking_id
           WHERE booking.trip_id = $1 AND booking.booked_by_user_id = $2`,
          [fixture.tripA, fixture.owner],
        ),
      ).resolves.toBe(0);
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.seat_reservations WHERE trip_id = $1`,
          [fixture.tripA],
        ),
      ).resolves.toBe(0);
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.booking_events WHERE company_id = $1`,
          [fixture.companyA],
        ),
      ).resolves.toBe(0);
    });
  });

  it('maps a missing boarding-station foreign key to a safe seat-selection error', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      await expect(
        service.createPassengerBooking(fixture.owner, 'missing-station', {
          tripId: fixture.tripA,
          passengers: [
            {
              ...passenger('1A'),
              boardingStationId: '9223372036854775807',
            },
          ],
        }),
      ).rejects.toBeInstanceOf(InvalidSeatSelectionError);
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.idempotency_records
            WHERE actor_user_id = $1 AND idempotency_key = $2`,
          [fixture.owner, 'missing-station'],
        ),
      ).resolves.toBe(0);
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.bookings
            WHERE booked_by_user_id = $1 AND trip_id = $2`,
          [fixture.owner, fixture.tripA],
        ),
      ).resolves.toBe(0);
    });
  });

  it('keeps the old price snapshot while a later booking uses the changed trip price', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      const first = await service.createPassengerBooking(
        fixture.owner,
        'price-a',
        {
          tripId: fixture.tripA,
          passengers: [passenger('1A')],
        },
      );
      await tx.query(`UPDATE public.trips SET price_mru = 725 WHERE id = $1`, [
        fixture.tripA,
      ]);
      const second = await service.createPassengerBooking(
        fixture.otherOwner,
        'price-b',
        {
          tripId: fixture.tripA,
          passengers: [passenger('1B')],
        },
      );

      expect(first.unitPrice).toBe('500.00');
      expect(first.totalAmount).toBe('500.00');
      expect(second.unitPrice).toBe('725.00');
      expect(second.totalAmount).toBe('725.00');
      const snapshots = await tx.query<{
        id: string;
        ticket_price_snapshot: string;
      }>(
        `SELECT id, ticket_price_snapshot::text
         FROM public.bookings WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[first.id, second.id]],
      );
      expect(
        new Map(
          snapshots.rows.map((row) => [row.id, row.ticket_price_snapshot]),
        ),
      ).toEqual(
        new Map([
          [first.id, '500.00'],
          [second.id, '725.00'],
        ]),
      );

      const savepoint = 'immutable_snapshot';
      await tx.query(`SAVEPOINT ${savepoint}`);
      await expect(
        tx.query(
          `UPDATE public.bookings SET ticket_price_snapshot = 1 WHERE id = $1`,
          [first.id],
        ),
      ).rejects.toBeDefined();
      await tx.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    });
  });

  it('releases a cancelled seat so it can be booked again', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      const first = await service.createPassengerBooking(
        fixture.owner,
        'cancel-first',
        { tripId: fixture.tripA, passengers: [passenger('1A')] },
      );
      await service.cancelOwnedBooking(fixture.owner, first.id);
      const replacement = await service.createPassengerBooking(
        fixture.otherOwner,
        'cancel-replacement',
        { tripId: fixture.tripA, passengers: [passenger('1A')] },
      );

      expect(replacement.id).not.toBe(first.id);
      const statuses = await tx.query<{ booking_id: string; status: string }>(
        `SELECT booking_id, status::text FROM public.seat_reservations
         WHERE booking_id = ANY($1::uuid[])`,
        [[first.id, replacement.id]],
      );
      expect(
        new Map(statuses.rows.map((row) => [row.booking_id, row.status])),
      ).toEqual(
        new Map([
          [first.id, 'CANCELLED'],
          [replacement.id, 'HELD'],
        ]),
      );
    });
  });

  it('expires holds, exposes the seat as available, and no longer blocks it', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      const expired = await service.createPassengerBooking(
        fixture.owner,
        'expire-first',
        { tripId: fixture.tripA, passengers: [passenger('1A')] },
      );
      await tx.query(
        `UPDATE public.bookings SET expires_at = now() - interval '1 minute'
         WHERE id = $1`,
        [expired.id],
      );
      await tx.query(
        `UPDATE public.seat_reservations
         SET held_until = now() - interval '1 minute' WHERE booking_id = $1`,
        [expired.id],
      );

      const availabilityBeforeRelease =
        await new PostgresAvailabilityRepository(tx).findPublicAvailability(
          fixture.tripA,
        );
      expect(
        availabilityBeforeRelease?.seats.find((seat) => seat.seatId === '1A'),
      ).toEqual({
        seatId: '1A',
        label: '1A',
        status: 'AVAILABLE',
        occupantGender: null,
      });

      const replacement = await service.createPassengerBooking(
        fixture.otherOwner,
        'expire-replacement',
        { tripId: fixture.tripA, passengers: [passenger('1A')] },
      );
      expect(replacement.id).not.toBe(expired.id);
      const old = await tx.query<{
        booking_status: string;
        seat_status: string;
      }>(
        `SELECT booking.status::text AS booking_status,
                seat.status::text AS seat_status
         FROM public.bookings booking
         JOIN public.seat_reservations seat ON seat.booking_id = booking.id
         WHERE booking.id = $1`,
        [expired.id],
      );
      expect(old.rows[0]).toEqual({
        booking_status: 'EXPIRED',
        seat_status: 'RELEASED',
      });
      await expect(
        rowCount(
          tx,
          `SELECT count(*) FROM public.booking_events
           WHERE booking_id = $1 AND event_type = 'EXPIRED'`,
          [expired.id],
        ),
      ).resolves.toBe(1);
    });
  });

  it('projects booked gender in the seat map without passenger PII', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      const booking = await service.createPassengerBooking(
        fixture.owner,
        'seat-map',
        {
          tripId: fixture.tripA,
          passengers: [passenger('2A', 'Secret Name', PassengerGender.Female)],
        },
      );
      await tx.query(
        `UPDATE public.seat_reservations
         SET status = 'CONFIRMED' WHERE booking_id = $1`,
        [booking.id],
      );

      const availability = await new PostgresAvailabilityRepository(
        tx,
      ).findPublicAvailability(fixture.tripA);
      const bookedSeat = availability?.seats.find(
        (seat) => seat.seatId === '2A',
      );
      expect(bookedSeat).toEqual({
        seatId: '2A',
        label: '2A',
        status: 'BOOKED',
        occupantGender: 'FEMALE',
      });
      expect(Object.keys(bookedSeat ?? {}).sort()).toEqual([
        'label',
        'occupantGender',
        'seatId',
        'status',
      ]);
      expect(JSON.stringify(availability)).not.toMatch(
        /Secret Name|\+22236000000|DOC-2A/,
      );
    });
  });

  it('returns an exact safe event allowlist despite sensitive actor and metadata columns', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      const repository = new PostgresBookingsRepository();
      const booking = await service.createPassengerBooking(
        fixture.owner,
        'event-allowlist',
        { tripId: fixture.tripA, passengers: [passenger('1A')] },
      );
      const secret = 'private-audit-metadata-value';
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO public.booking_events
           (booking_id, company_id, actor_user_id, event_type, metadata)
         VALUES ($1, $2, $3, 'CANCELLED', jsonb_build_object('secret', $4::text))
         RETURNING id::text`,
        [booking.id, fixture.companyA, fixture.outsider, secret],
      );

      const events = await repository.listEventsForOwner(
        tx,
        fixture.owner,
        booking.id,
        resolvePagination(),
      );
      const sensitiveEvent = events?.items.find(
        (event) => event.id === inserted.rows[0].id,
      );
      expect(Object.keys(sensitiveEvent ?? {}).sort()).toEqual([
        'eventTime',
        'eventType',
        'id',
      ]);
      expect(JSON.stringify(events)).not.toContain(secret);
      expect(JSON.stringify(events)).not.toContain(fixture.outsider);

      const stored = await tx.query<{
        actor_user_id: string;
        metadata: { secret: string };
      }>(
        `SELECT actor_user_id, metadata
           FROM public.booking_events WHERE id = $1`,
        [inserted.rows[0].id],
      );
      expect(stored.rows[0]).toEqual({
        actor_user_id: fixture.outsider,
        metadata: { secret },
      });
    });
  });

  it('enforces owner, tenant, and branch predicates in repository SQL', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      const repository = new PostgresBookingsRepository();
      const owned = await service.createPassengerBooking(
        fixture.owner,
        'scope-owned',
        { tripId: fixture.tripA, passengers: [passenger('1A')] },
      );
      const branch = await service.createAgentBooking(
        fixture.manager,
        fixture.companyA,
        fixture.branchA,
        'scope-branch',
        { tripId: fixture.tripA, passengers: [passenger('1B')] },
      );

      await expect(
        repository.findForOwner(tx, fixture.owner, owned.id),
      ).resolves.toMatchObject({ id: owned.id });
      await expect(
        repository.findForOwner(tx, fixture.otherOwner, owned.id),
      ).resolves.toBeNull();
      await expect(
        repository.findForCompany(
          tx,
          fixture.companyA,
          fixture.manager,
          { companyWide: true, branchIds: [] },
          owned.id,
        ),
      ).resolves.toMatchObject({ id: owned.id });
      await expect(
        repository.findForCompany(
          tx,
          fixture.companyB,
          fixture.outsider,
          { companyWide: true, branchIds: [] },
          owned.id,
        ),
      ).resolves.toBeNull();
      await expect(
        repository.findForCompany(
          tx,
          fixture.companyA,
          fixture.otherOwner,
          { companyWide: false, branchIds: [fixture.branchA] },
          branch.id,
        ),
      ).resolves.toMatchObject({ id: branch.id });
      await expect(
        repository.findForCompany(
          tx,
          fixture.companyA,
          fixture.otherOwner,
          { companyWide: false, branchIds: [fixture.branchB] },
          branch.id,
        ),
      ).resolves.toBeNull();

      const ownerPage = await repository.listForOwner(
        tx,
        fixture.owner,
        resolvePagination(),
      );
      expect(ownerPage.items.map((item) => item.id)).toEqual([owned.id]);
      const wrongTenantPage = await repository.listForCompany(
        tx,
        fixture.companyB,
        fixture.outsider,
        { companyWide: true, branchIds: [] },
        resolvePagination(),
      );
      expect(wrongTenantPage.items).toHaveLength(0);
    });
  });

  it('enforces booking, passenger, seat, and event RLS reads and denies direct writes', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      const booking = await service.createPassengerBooking(
        fixture.owner,
        'rls-booking',
        { tripId: fixture.tripA, passengers: [passenger('1A')] },
      );

      await setAuthenticated(tx, fixture.owner);
      for (const table of [
        'bookings',
        'passengers',
        'seat_reservations',
        'booking_events',
      ]) {
        const rows = await tx.query(
          `SELECT id FROM public.${table} WHERE ${
            table === 'bookings' ? 'id' : 'booking_id'
          } = $1`,
          [booking.id],
        );
        expect(rows.rows).toHaveLength(1);
      }
      await expectPermissionDenied(
        tx,
        `UPDATE public.bookings SET status = status WHERE id = '${booking.id}'`,
      );
      await expectPermissionDenied(
        tx,
        `UPDATE public.passengers SET full_name = full_name WHERE booking_id = '${booking.id}'`,
      );
      await expectPermissionDenied(
        tx,
        `UPDATE public.seat_reservations SET status = status WHERE booking_id = '${booking.id}'`,
      );
      await expectPermissionDenied(
        tx,
        `UPDATE public.booking_events SET event_time = event_time WHERE booking_id = '${booking.id}'`,
      );
      await expectPermissionDenied(
        tx,
        `SELECT id FROM public.idempotency_records
          WHERE actor_user_id = '${fixture.owner}'`,
      );
      await expectPermissionDenied(
        tx,
        `INSERT INTO public.idempotency_records
           (company_id, actor_user_id, operation, idempotency_key,
            request_fingerprint)
         VALUES (${fixture.companyA}, '${fixture.owner}', 'RLS_PROBE',
                 'rls-insert', '${'0'.repeat(64)}')`,
      );
      await expectPermissionDenied(
        tx,
        `UPDATE public.idempotency_records SET expires_at = expires_at`,
      );
      await expectPermissionDenied(
        tx,
        `DELETE FROM public.idempotency_records
          WHERE actor_user_id = '${fixture.owner}'`,
      );
      await tx.query(`RESET role`);

      await setAuthenticated(tx, fixture.manager);
      for (const table of [
        'bookings',
        'passengers',
        'seat_reservations',
        'booking_events',
      ]) {
        const rows = await tx.query(
          `SELECT id FROM public.${table} WHERE ${
            table === 'bookings' ? 'id' : 'booking_id'
          } = $1`,
          [booking.id],
        );
        expect(rows.rows).toHaveLength(1);
      }
      await tx.query(`RESET role`);

      await setAuthenticated(tx, fixture.outsider);
      for (const table of [
        'bookings',
        'passengers',
        'seat_reservations',
        'booking_events',
      ]) {
        const rows = await tx.query(
          `SELECT id FROM public.${table} WHERE ${
            table === 'bookings' ? 'id' : 'booking_id'
          } = $1`,
          [booking.id],
        );
        expect(rows.rows).toHaveLength(0);
      }
      await tx.query(`RESET role`);
    });
  });

  it('enforces branch RLS and revocation across the full agent-created aggregate', async () => {
    if (!available) return;
    await inRollback(async (tx, fixture, service) => {
      const agent = randomUUID();
      const wrongBranchAgent = randomUUID();
      await tx.query(
        `INSERT INTO auth.users (id, email, raw_user_meta_data)
         VALUES ($1, $2, jsonb_build_object('full_name', 'RLS Agent')),
                ($3, $4, jsonb_build_object('full_name', 'Wrong Branch Agent'))`,
        [
          agent,
          `${agent}@booking-itest.local`,
          wrongBranchAgent,
          `${wrongBranchAgent}@booking-itest.local`,
        ],
      );
      await tx.query(
        `INSERT INTO public.company_memberships
           (user_id, company_id, branch_id, role)
         VALUES ($1, $2, $3, 'AGENT'),
                ($4, $2, $5, 'BRANCH_EMPLOYEE')`,
        [
          agent,
          fixture.companyA,
          fixture.branchA,
          wrongBranchAgent,
          fixture.branchB,
        ],
      );
      const booking = await service.createAgentBooking(
        agent,
        fixture.companyA,
        fixture.branchA,
        'rls-agent-booking',
        { tripId: fixture.tripA, passengers: [passenger('1B')] },
      );

      await setAuthenticated(tx, agent);
      for (const table of [
        'bookings',
        'passengers',
        'seat_reservations',
        'booking_events',
      ]) {
        const active = await tx.query(
          `SELECT id FROM public.${table} WHERE ${
            table === 'bookings' ? 'id' : 'booking_id'
          } = $1`,
          [booking.id],
        );
        expect(active.rows).toHaveLength(1);
      }
      await tx.query(`RESET role`);

      await setAuthenticated(tx, wrongBranchAgent);
      for (const table of [
        'bookings',
        'passengers',
        'seat_reservations',
        'booking_events',
      ]) {
        const hidden = await tx.query(
          `SELECT id FROM public.${table} WHERE ${
            table === 'bookings' ? 'id' : 'booking_id'
          } = $1`,
          [booking.id],
        );
        expect(hidden.rows).toHaveLength(0);
      }
      await tx.query(`RESET role`);

      await tx.query(
        `UPDATE public.company_memberships
            SET is_active = false
          WHERE user_id = $1 AND company_id = $2 AND branch_id = $3`,
        [agent, fixture.companyA, fixture.branchA],
      );
      await setAuthenticated(tx, agent);
      for (const table of [
        'bookings',
        'passengers',
        'seat_reservations',
        'booking_events',
      ]) {
        const revoked = await tx.query(
          `SELECT id FROM public.${table} WHERE ${
            table === 'bookings' ? 'id' : 'booking_id'
          } = $1`,
          [booking.id],
        );
        expect(revoked.rows).toHaveLength(0);
      }
      await tx.query(`RESET role`);
    });
  });

  it('orders trip cancellation before booking and rejects the booking after the lock releases', async () => {
    if (!available) return;
    await withCommittedSeed(async (fixture) => {
      const cancellationLocked = new Deferred();
      const releaseCancellation = new Deferred();
      const bookingApplication = `audit-book-after-cancel-${randomUUID().slice(0, 8)}`;
      const tripRepository = new PostgresTripsRepository();
      const cancellation = transactions.run(async (tx) => {
        const trip = await tripRepository.transition(
          tx,
          fixture.companyA,
          fixture.tripA,
          [TripStatus.Scheduled],
          TripStatus.Cancelled,
          null,
        );
        cancellationLocked.resolve();
        await releaseCancellation.promise;
        return trip;
      });
      let bookingAttempt: Promise<unknown> | undefined;

      try {
        await cancellationLocked.promise;
        const service = new BookingsService(
          new NamedTripLockRepository(bookingApplication),
          database,
          transactions,
        );
        bookingAttempt = service.createPassengerBooking(
          fixture.owner,
          'cancel-first-lock-order',
          { tripId: fixture.tripA, passengers: [passenger('1A')] },
        );
        const rejected =
          expect(bookingAttempt).rejects.toBeInstanceOf(TripNotBookableError);
        await waitForLockWait(bookingApplication);
        releaseCancellation.resolve();

        await expect(cancellation).resolves.toMatchObject({
          status: TripStatus.Cancelled,
        });
        await rejected;
        await expect(
          rowCount(
            pool as unknown as DatabaseExecutor,
            `SELECT count(*) FROM public.bookings WHERE trip_id = $1`,
            [fixture.tripA],
          ),
        ).resolves.toBe(0);
      } finally {
        releaseCancellation.resolve();
        await settleDefined([cancellation, bookingAttempt]);
      }
    });
  });

  it('orders booking before trip cancellation and commits the booking before cancellation proceeds', async () => {
    if (!available) return;
    await withCommittedSeed(async (fixture) => {
      const bookingLocked = new Deferred();
      const releaseBooking = new Deferred();
      const bookingApplication = `audit-book-first-${randomUUID().slice(0, 8)}`;
      const cancellationApplication = `audit-trip-cancel-${randomUUID().slice(0, 8)}`;
      const service = new BookingsService(
        new PausingTripLockRepository(
          bookingApplication,
          bookingLocked,
          releaseBooking,
        ),
        database,
        transactions,
      );
      const booking = service.createPassengerBooking(
        fixture.owner,
        'booking-first-lock-order',
        { tripId: fixture.tripA, passengers: [passenger('1A')] },
      );
      let cancellation: Promise<unknown> | undefined;

      try {
        await bookingLocked.promise;
        cancellation = transactions.run(async (tx) => {
          await tx.query(`SELECT set_config('application_name', $1, true)`, [
            cancellationApplication,
          ]);
          return new PostgresTripsRepository().transition(
            tx,
            fixture.companyA,
            fixture.tripA,
            [TripStatus.Scheduled],
            TripStatus.Cancelled,
            null,
          );
        });
        await waitForLockWait(cancellationApplication);
        releaseBooking.resolve();

        await expect(booking).resolves.toMatchObject({
          tripId: fixture.tripA,
          status: 'HELD',
        });
        await expect(cancellation).resolves.toMatchObject({
          status: TripStatus.Cancelled,
        });
        await expect(
          rowCount(
            pool as unknown as DatabaseExecutor,
            `SELECT count(*) FROM public.bookings WHERE trip_id = $1`,
            [fixture.tripA],
          ),
        ).resolves.toBe(1);
      } finally {
        releaseBooking.resolve();
        await settleDefined([booking, cancellation]);
      }
    });
  });

  it('does not wait on a locked booking aggregate for unauthorized owner or company cancellation', async () => {
    if (!available) return;
    await withCommittedSeed(async (fixture) => {
      const service = new BookingsService(
        new PostgresBookingsRepository(),
        database,
        transactions,
      );
      const booking = await service.createPassengerBooking(
        fixture.owner,
        'unauthorized-lock-probe',
        { tripId: fixture.tripA, passengers: [passenger('1A')] },
      );
      const locker = await pool.connect();
      await locker.query('BEGIN');
      await locker.query(
        `SELECT id FROM public.bookings WHERE id = $1 FOR UPDATE`,
        [booking.id],
      );

      const probe = async (
        attempt: (
          repository: PostgresBookingsRepository,
          executor: DatabaseExecutor,
        ) => Promise<boolean>,
      ): Promise<boolean> => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`SET LOCAL lock_timeout = '250ms'`);
          const visible = await attempt(new PostgresBookingsRepository(), {
            query: (text, params) => client.query(text, params as unknown[]),
          } as DatabaseExecutor);
          await client.query('COMMIT');
          return visible;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      };

      try {
        await expect(
          probe((repository, executor) =>
            repository.lockOwnedBookingForCancellation(
              executor,
              fixture.otherOwner,
              booking.id,
            ),
          ),
        ).resolves.toBe(false);
        await expect(
          probe((repository, executor) =>
            repository.lockCompanyBookingForCancellation(
              executor,
              fixture.companyB,
              { companyWide: true, branchIds: [] },
              booking.id,
            ),
          ),
        ).resolves.toBe(false);
      } finally {
        await locker.query('ROLLBACK');
        locker.release();
      }
    });
  });

  it('serializes cancellation first against conditional check-in using booking-then-seat locks', async () => {
    if (!available) return;
    await withCommittedSeed(async (fixture) => {
      const baseService = new BookingsService(
        new PostgresBookingsRepository(),
        database,
        transactions,
      );
      const booking = await baseService.createPassengerBooking(
        fixture.owner,
        'cancel-before-check-in',
        { tripId: fixture.tripA, passengers: [passenger('1A')] },
      );
      await pool.query(
        `UPDATE public.seat_reservations
            SET status = 'CONFIRMED', held_until = NULL
          WHERE booking_id = $1`,
        [booking.id],
      );
      const cancellationLocked = new Deferred();
      const releaseCancellation = new Deferred();
      const checkInApplication = `audit-check-after-cancel-${randomUUID().slice(0, 8)}`;
      const cancellationService = new BookingsService(
        new NamedCancellationRepository(
          `audit-cancel-first-${randomUUID().slice(0, 8)}`,
          cancellationLocked,
          releaseCancellation,
        ),
        database,
        transactions,
      );
      const cancellation = cancellationService.cancelOwnedBooking(
        fixture.owner,
        booking.id,
      );
      let checkIn: Promise<number> | undefined;

      try {
        await cancellationLocked.promise;
        checkIn = conditionalCheckIn(
          await pool.connect(),
          booking.id,
          checkInApplication,
        );
        await waitForLockWait(checkInApplication);
        releaseCancellation.resolve();

        await expect(cancellation).resolves.toMatchObject({
          status: 'CANCELLED',
          version: 2,
        });
        await expect(checkIn).resolves.toBe(0);
        const state = await pool.query<{
          booking_status: string;
          seat_status: string;
        }>(
          `SELECT booking.status::text AS booking_status,
                  seat.status::text AS seat_status
             FROM public.bookings booking
             JOIN public.seat_reservations seat
               ON seat.booking_id = booking.id
            WHERE booking.id = $1`,
          [booking.id],
        );
        expect(state.rows[0]).toEqual({
          booking_status: 'CANCELLED',
          seat_status: 'CANCELLED',
        });
      } finally {
        releaseCancellation.resolve();
        await settleDefined([cancellation, checkIn]);
      }
    });
  });

  it('serializes conditional check-in first and leaves cancellation as a terminal no-op', async () => {
    if (!available) return;
    await withCommittedSeed(async (fixture) => {
      const baseService = new BookingsService(
        new PostgresBookingsRepository(),
        database,
        transactions,
      );
      const booking = await baseService.createPassengerBooking(
        fixture.owner,
        'check-in-before-cancel',
        { tripId: fixture.tripA, passengers: [passenger('1A')] },
      );
      await pool.query(
        `UPDATE public.seat_reservations
            SET status = 'CONFIRMED', held_until = NULL
          WHERE booking_id = $1`,
        [booking.id],
      );
      const checkInLocked = new Deferred();
      const releaseCheckIn = new Deferred();
      const checkIn = conditionalCheckIn(
        await pool.connect(),
        booking.id,
        `audit-check-first-${randomUUID().slice(0, 8)}`,
        checkInLocked,
        releaseCheckIn,
      );
      let cancellation: Promise<unknown> | undefined;

      try {
        await checkInLocked.promise;
        const cancellationApplication = `audit-cancel-after-check-${randomUUID().slice(0, 8)}`;
        const cancellationService = new BookingsService(
          new NamedCancellationRepository(cancellationApplication),
          database,
          transactions,
        );
        cancellation = cancellationService.cancelOwnedBooking(
          fixture.owner,
          booking.id,
        );
        const rejected = expect(cancellation).rejects.toBeInstanceOf(
          BookingNotCancellableError,
        );
        await waitForLockWait(cancellationApplication);
        releaseCheckIn.resolve();

        await expect(checkIn).resolves.toBe(1);
        await rejected;
        const state = await pool.query<{
          booking_status: string;
          version: number;
          seat_status: string;
          cancelled_events: string;
        }>(
          `SELECT booking.status::text AS booking_status, booking.version,
                  seat.status::text AS seat_status,
                  count(event.id) FILTER (
                    WHERE event.event_type = 'CANCELLED'
                  )::text AS cancelled_events
             FROM public.bookings booking
             JOIN public.seat_reservations seat
               ON seat.booking_id = booking.id
             LEFT JOIN public.booking_events event
               ON event.booking_id = booking.id
            WHERE booking.id = $1
            GROUP BY booking.id, seat.id`,
          [booking.id],
        );
        expect(state.rows[0]).toEqual({
          booking_status: 'HELD',
          version: 1,
          seat_status: 'CHECKED_IN',
          cancelled_events: '0',
        });
      } finally {
        releaseCheckIn.resolve();
        await settleDefined([checkIn, cancellation]);
      }
    });
  });

  it('lets two expiration workers produce [0, 1] with one state bump, release, and event', async () => {
    if (!available) return;
    await withCommittedSeed(async (fixture) => {
      const creator = new BookingsService(
        new PostgresBookingsRepository(),
        database,
        transactions,
      );
      const booking = await creator.createPassengerBooking(
        fixture.owner,
        'simultaneous-expiration',
        { tripId: fixture.tripA, passengers: [passenger('1A')] },
      );
      await pool.query(
        `UPDATE public.bookings
            SET expires_at = now() - interval '1 minute'
          WHERE id = $1`,
        [booking.id],
      );
      await pool.query(
        `UPDATE public.seat_reservations
            SET held_until = now() - interval '1 minute'
          WHERE booking_id = $1`,
        [booking.id],
      );
      const gate = new TwoPartyGate();
      const workers = [
        new ExpireBookingUseCase(
          new BookingsService(
            new SimultaneousExpirationRepository(gate),
            database,
            transactions,
          ),
        ),
        new ExpireBookingUseCase(
          new BookingsService(
            new SimultaneousExpirationRepository(gate),
            database,
            transactions,
          ),
        ),
      ];

      const counts = await Promise.all(
        workers.map((worker) => worker.execute(fixture.companyA)),
      );
      expect(counts.sort()).toEqual([0, 1]);
      const state = await pool.query<{
        booking_status: string;
        version: number;
        seat_status: string;
        expired_events: string;
      }>(
        `SELECT booking.status::text AS booking_status, booking.version,
                seat.status::text AS seat_status,
                count(event.id) FILTER (
                  WHERE event.event_type = 'EXPIRED'
                )::text AS expired_events
           FROM public.bookings booking
           JOIN public.seat_reservations seat
             ON seat.booking_id = booking.id
           LEFT JOIN public.booking_events event
             ON event.booking_id = booking.id
          WHERE booking.id = $1
          GROUP BY booking.id, seat.id`,
        [booking.id],
      );
      expect(state.rows[0]).toEqual({
        booking_status: 'EXPIRED',
        version: 2,
        seat_status: 'RELEASED',
        expired_events: '1',
      });
      await expect(workers[0].execute(fixture.companyA)).resolves.toBe(0);
      await expect(
        rowCount(
          pool as unknown as DatabaseExecutor,
          `SELECT count(*) FROM public.booking_events
            WHERE booking_id = $1 AND event_type = 'EXPIRED'`,
          [booking.id],
        ),
      ).resolves.toBe(1);
    });
  });

  it('creates at most one booking when an expired key is reclaimed concurrently', async () => {
    if (!available || !committed) return;
    const key = 'expired-concurrent-reclaim';
    await pool.query(
      `INSERT INTO public.idempotency_records
         (company_id, actor_user_id, operation, idempotency_key,
          request_fingerprint, expires_at)
       VALUES ($1, $2, 'CREATE_PASSENGER_BOOKING', $3, $4,
               now() - interval '1 second')`,
      [committed.companyA, committed.owner, key, '0'.repeat(64)],
    );
    const service = new BookingsService(
      new SimultaneousClaimRepository(),
      database,
      transactions,
    );
    const input = {
      tripId: committed.tripA,
      passengers: [passenger('2B')],
    };

    const attempts = await Promise.all([
      service.createPassengerBooking(committed.owner, key, input),
      service.createPassengerBooking(committed.owner, key, input),
    ]);

    expect(attempts[0].id).toBe(attempts[1].id);
    await expect(
      rowCount(
        pool as unknown as DatabaseExecutor,
        `SELECT count(*) FROM public.bookings
          WHERE trip_id = $1 AND booked_by_user_id = $2
            AND id = $3`,
        [committed.tripA, committed.owner, attempts[0].id],
      ),
    ).resolves.toBe(1);
    await expect(
      rowCount(
        pool as unknown as DatabaseExecutor,
        `SELECT count(*) FROM public.idempotency_records
          WHERE company_id = $1 AND actor_user_id = $2
            AND operation = 'CREATE_PASSENGER_BOOKING'
            AND idempotency_key = $3 AND booking_id = $4
            AND completed_at IS NOT NULL`,
        [committed.companyA, committed.owner, key, attempts[0].id],
      ),
    ).resolves.toBe(1);
    await service.cancelOwnedBooking(committed.owner, attempts[0].id);
  });

  it('allows exactly one simultaneous booking for the same seat', async () => {
    if (!available || !committed) return;
    const service = new BookingsService(
      new SimultaneousSeatRepository(),
      database,
      transactions,
    );
    const attempts = await Promise.allSettled([
      service.createPassengerBooking(committed.owner, 'race-same-owner', {
        tripId: committed.tripA,
        passengers: [passenger('1A')],
      }),
      service.createPassengerBooking(committed.otherOwner, 'race-same-other', {
        tripId: committed.tripA,
        passengers: [passenger('1A')],
      }),
    ]);

    const fulfilled = attempts.filter(
      (result) => result.status === 'fulfilled',
    );
    const rejected = attempts.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ status: 409 });
    await expect(
      rowCount(
        pool as unknown as DatabaseExecutor,
        `SELECT count(*) FROM public.seat_reservations
         WHERE trip_id = $1 AND seat_number = '1A'
           AND status IN ('HELD', 'CONFIRMED', 'CHECKED_IN')`,
        [committed.tripA],
      ),
    ).resolves.toBe(1);
    await expect(
      rowCount(
        pool as unknown as DatabaseExecutor,
        `SELECT count(*) FROM public.idempotency_records
         WHERE company_id = $1
           AND idempotency_key IN ('race-same-owner', 'race-same-other')
           AND completed_at IS NOT NULL`,
        [committed.companyA],
      ),
    ).resolves.toBe(1);
  });

  it('allows simultaneous bookings for different seats', async () => {
    if (!available || !committed) return;
    const service = new BookingsService(
      new SimultaneousSeatRepository(),
      database,
      transactions,
    );
    const bookings = await Promise.all([
      service.createPassengerBooking(committed.owner, 'race-different-a', {
        tripId: committed.tripA,
        passengers: [passenger('1B')],
      }),
      service.createPassengerBooking(committed.otherOwner, 'race-different-b', {
        tripId: committed.tripA,
        passengers: [passenger('2A')],
      }),
    ]);

    expect(new Set(bookings.map((booking) => booking.id)).size).toBe(2);
    await expect(
      rowCount(
        pool as unknown as DatabaseExecutor,
        `SELECT count(*) FROM public.seat_reservations
         WHERE trip_id = $1 AND seat_number IN ('1B', '2A')
           AND status = 'HELD'`,
        [committed.tripA],
      ),
    ).resolves.toBe(2);
  });
});
