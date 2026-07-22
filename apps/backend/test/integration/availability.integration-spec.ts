import { randomUUID } from 'node:crypto';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { AppModule } from '../../src/app.module';
import { resolvePagination } from '../../src/common/pagination/pagination';
import { DatabaseService } from '../../src/infrastructure/database';
import { DatabaseErrorMapper } from '../../src/infrastructure/database/database-error.mapper';
import type { DatabaseExecutor } from '../../src/infrastructure/database/database.types';
import {
  Transaction,
  TransactionManager,
} from '../../src/infrastructure/database/transaction.manager';
import { AvailabilityController } from '../../src/modules/availability/availability.controller';
import { AvailabilityModule } from '../../src/modules/availability/availability.module';
import { AVAILABILITY_REPOSITORY } from '../../src/modules/availability/availability.repository';
import { AvailabilityService } from '../../src/modules/availability/availability.service';
import { PostgresAvailabilityRepository } from '../../src/modules/availability/postgres-availability.repository';
import { PassengerGender } from '../../src/modules/bookings/booking.types';
import { TripNotBookableError } from '../../src/modules/bookings/booking.errors';
import { BookingsService } from '../../src/modules/bookings/bookings.service';
import { PostgresBookingsRepository } from '../../src/modules/bookings/postgres-bookings.repository';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

interface Fixture {
  readonly owner: string;
  readonly companyId: string;
  readonly routeId: string;
  readonly originId: string;
  readonly destinationId: string;
  readonly layoutId: string;
  readonly eligibleTripIds: readonly [string, string, string];
  readonly cancelledTripId: string;
  readonly inactiveTripId: string;
  readonly closedTripId: string;
  readonly inactiveBusTripId: string;
  readonly firstBusId: string;
  readonly departureDay: Date;
}

describe('Public availability (PostgreSQL integration)', () => {
  let pool: Pool;
  let transactions: TransactionManager;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    pool.on('error', () => undefined);
    const mapper = new DatabaseErrorMapper();
    transactions = new TransactionManager(pool, mapper);

    try {
      await pool.query('SELECT 1');
    } catch (error) {
      throw new Error(
        `Availability integration tests require PostgreSQL at ${DATABASE_URL}.`,
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
  });

  afterAll(async () => {
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

  async function seed(tx: Transaction): Promise<Fixture> {
    const owner = randomUUID();
    const suffix = owner.slice(0, 8);
    await tx.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data)
       VALUES ($1, $2, jsonb_build_object('full_name', 'Availability Owner'))`,
      [owner, `${owner}@availability-itest.local`],
    );
    const companyId = await scalar(
      tx,
      `INSERT INTO public.companies (name, logo_url, contact_phone)
       VALUES ($1, $2, $3) RETURNING id`,
      [
        `Availability ${suffix}`,
        `https://cdn.test/${suffix}.png`,
        '+22299999999',
      ],
    );
    const cityId = await scalar(
      tx,
      `INSERT INTO public.cities (name_ar, name_fr) VALUES ($1, $2) RETURNING id`,
      [`مدينة-${suffix}`, `Availability-${suffix}`],
    );
    const originId = await scalar(
      tx,
      `INSERT INTO public.stations
         (city_id, name_ar, name_fr, latitude, longitude)
       VALUES ($1, $2, $3, 18.0735, -15.9582) RETURNING id`,
      [cityId, `أصل-${suffix}`, `Origin-${suffix}`],
    );
    const destinationId = await scalar(
      tx,
      `INSERT INTO public.stations
         (city_id, name_ar, name_fr, latitude, longitude)
       VALUES ($1, $2, $3, 16.6171, -7.2565) RETURNING id`,
      [cityId, `وجهة-${suffix}`, `Destination-${suffix}`],
    );
    const layoutId = await scalar(
      tx,
      `INSERT INTO public.seat_layouts (name, total_seats, layout_grid)
       VALUES ($1, 4, '["1A", "1B", "2A", "2B"]'::jsonb)
       RETURNING id`,
      [`Availability layout ${suffix}`],
    );
    const routeId = await scalar(
      tx,
      `INSERT INTO public.routes
         (company_id, origin_station_id, destination_station_id,
          default_price_mru, estimated_duration_minutes, currency)
       VALUES ($1, $2, $3, 777.77, 180, 'MRU') RETURNING id`,
      [companyId, originId, destinationId],
    );

    const busIds: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      busIds.push(
        await scalar(
          tx,
          `INSERT INTO public.buses
             (company_id, seat_layout_id, plate_number, bus_model)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [
            companyId,
            layoutId,
            `AVL-${suffix}-${index}`,
            `Private model ${index}`,
          ],
        ),
      );
    }

    const clock = await tx.query<{ departure_day: Date }>(
      `SELECT date_trunc('day', now()) + interval '2 days' AS departure_day`,
    );
    const departureDay = clock.rows[0].departure_day;
    const atHour = (hour: number): Date =>
      new Date(departureDay.getTime() + hour * 60 * 60 * 1_000);
    const insertTrip = (
      busId: string,
      departureHour: number,
      status = 'SCHEDULED',
      isActive = true,
      boardingClosesAt = atHour(departureHour - 1),
    ): Promise<string> =>
      scalar(
        tx,
        `INSERT INTO public.trips
           (company_id, route_id, bus_id, departure_time,
            estimated_arrival_time, price_mru, currency, status,
            boarding_closes_at, is_active)
         VALUES ($1, $2, $3, $4, $5, 123.45, 'MRU',
                 $6::public.trip_status_enum, $7, $8)
         RETURNING id`,
        [
          companyId,
          routeId,
          busId,
          atHour(departureHour),
          atHour(departureHour + 3),
          status,
          boardingClosesAt,
          isActive,
        ],
      );

    const eligibleTripIds = [
      await insertTrip(busIds[0], 8),
      await insertTrip(busIds[1], 8),
      await insertTrip(busIds[2], 10),
    ] as [string, string, string];
    const cancelledTripId = await insertTrip(busIds[3], 9, 'CANCELLED');
    const inactiveTripId = await insertTrip(busIds[4], 9, 'SCHEDULED', false);
    const closedTripId = await insertTrip(
      busIds[5],
      11,
      'SCHEDULED',
      true,
      new Date(Date.now() - 60_000),
    );
    const inactiveBusTripId = await insertTrip(busIds[6], 12);
    await tx.query(`UPDATE public.buses SET is_active = false WHERE id = $1`, [
      busIds[6],
    ]);

    return {
      owner,
      companyId,
      routeId,
      originId,
      destinationId,
      layoutId,
      eligibleTripIds,
      cancelledTripId,
      inactiveTripId,
      closedTripId,
      inactiveBusTripId,
      firstBusId: busIds[0],
      departureDay,
    };
  }

  async function inRollback(
    work: (tx: Transaction, fixture: Fixture) => Promise<void>,
  ): Promise<void> {
    const sentinel = new Error('availability-rollback-sentinel');
    try {
      await transactions.run(async (tx) => {
        await tx.query(`SET LOCAL TIME ZONE 'UTC'`);
        const fixture = await seed(tx);
        await work(tx, fixture);
        throw sentinel;
      });
    } catch (error) {
      if (error !== sentinel) throw error;
    }
  }

  function searchFilter(fixture: Fixture) {
    return {
      originStationId: fixture.originId,
      destinationStationId: fixture.destinationId,
      departureFrom: fixture.departureDay,
      departureBefore: new Date(
        fixture.departureDay.getTime() + 24 * 60 * 60 * 1_000,
      ),
    };
  }

  function buildBookingService(tx: Transaction): BookingsService {
    let savepoint = 0;
    const nested = {
      run: async <T>(
        work: (executor: Transaction) => Promise<T>,
      ): Promise<T> => {
        const name = `availability_booking_sp_${++savepoint}`;
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

  async function counts(
    tx: Transaction,
    tripId: string,
  ): Promise<{ bookings: number; reservations: number }> {
    const result = await tx.query<{
      bookings: number;
      reservations: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM public.bookings WHERE trip_id = $1) AS bookings,
         (SELECT count(*)::integer FROM public.seat_reservations WHERE trip_id = $1) AS reservations`,
      [tripId],
    );
    return result.rows[0];
  }

  it('searches only eligible open scheduled trips with deterministic real pagination and a narrow projection', async () => {
    await inRollback(async (tx, fixture) => {
      const repository = new PostgresAvailabilityRepository(tx);
      const firstPage = await repository.searchPublicTrips(
        searchFilter(fixture),
        resolvePagination({ page: 1, pageSize: 2 }),
      );
      const secondPage = await repository.searchPublicTrips(
        searchFilter(fixture),
        resolvePagination({ page: 2, pageSize: 2 }),
      );

      expect(firstPage.total).toBe(3);
      expect(secondPage.total).toBe(3);
      expect(firstPage.items.map((trip) => trip.tripId)).toEqual(
        fixture.eligibleTripIds.slice(0, 2),
      );
      expect(secondPage.items.map((trip) => trip.tripId)).toEqual([
        fixture.eligibleTripIds[2],
      ]);
      expect(
        [...firstPage.items, ...secondPage.items].map((trip) => trip.tripId),
      ).not.toEqual(
        expect.arrayContaining([
          fixture.cancelledTripId,
          fixture.inactiveTripId,
          fixture.closedTripId,
          fixture.inactiveBusTripId,
        ]),
      );
      expect(firstPage.items[0]).toMatchObject({
        tripId: fixture.eligibleTripIds[0],
        estimatedPrice: '123.45',
        currency: 'MRU',
        availableSeatCount: 4,
      });
      expect(Object.keys(firstPage.items[0]).sort()).toEqual([
        'availableSeatCount',
        'company',
        'currency',
        'departureTime',
        'destinationStation',
        'estimatedArrivalTime',
        'estimatedPrice',
        'originStation',
        'tripId',
      ]);
      expect(Object.keys(firstPage.items[0].company).sort()).toEqual([
        'id',
        'logoUrl',
        'name',
      ]);
      expect(JSON.stringify(firstPage.items)).not.toMatch(
        /contact_phone|99999999|Private model|plate|busId|routeId|boardingClosesAt|driver|assistant/i,
      );

      for (const [table, id] of [
        ['companies', fixture.companyId],
        ['routes', fixture.routeId],
        ['stations', fixture.originId],
      ] as const) {
        await tx.query(
          `UPDATE public.${table} SET is_active = false WHERE id = $1`,
          [id],
        );
        await expect(
          repository.searchPublicTrips(
            searchFilter(fixture),
            resolvePagination(),
          ),
        ).resolves.toMatchObject({ items: [], total: 0 });
        await tx.query(
          `UPDATE public.${table} SET is_active = true WHERE id = $1`,
          [id],
        );
      }

      await tx.query(
        `UPDATE public.buses SET is_active = false WHERE id = $1`,
        [fixture.firstBusId],
      );
      const withoutFirstBus = await repository.searchPublicTrips(
        searchFilter(fixture),
        resolvePagination(),
      );
      expect(withoutFirstBus.total).toBe(2);
      expect(withoutFirstBus.items.map((trip) => trip.tripId)).not.toContain(
        fixture.eligibleTripIds[0],
      );
      await expect(
        buildBookingService(tx).createPassengerBooking(
          fixture.owner,
          'inactive-bus-not-bookable',
          {
            tripId: fixture.eligibleTripIds[0],
            passengers: [{ fullName: 'Hidden trip', seatId: '1A' }],
          },
        ),
      ).rejects.toBeInstanceOf(TripNotBookableError);
    });
  });

  it('previews decimal PostgreSQL totals from the mutable trip snapshot without creating holds', async () => {
    await inRollback(async (tx, fixture) => {
      const repository = new PostgresAvailabilityRepository(tx);
      const tripId = fixture.eligibleTripIds[0];
      const before = await counts(tx, tripId);

      await expect(
        repository.findPublicPricePreview(tripId, 1),
      ).resolves.toEqual({
        tripId,
        estimatedUnitPrice: '123.45',
        passengerCount: 1,
        estimatedTotal: '123.45',
        currency: 'MRU',
        isEstimate: true,
      });
      await expect(
        repository.findPublicPricePreview(tripId, 3),
      ).resolves.toEqual({
        tripId,
        estimatedUnitPrice: '123.45',
        passengerCount: 3,
        estimatedTotal: '370.35',
        currency: 'MRU',
        isEstimate: true,
      });

      await tx.query(
        `UPDATE public.routes SET default_price_mru = 999.99 WHERE id = $1`,
        [fixture.routeId],
      );
      await expect(
        repository.findPublicPricePreview(tripId, 2),
      ).resolves.toMatchObject({
        estimatedUnitPrice: '123.45',
        estimatedTotal: '246.90',
      });

      await tx.query(
        `UPDATE public.trips SET price_mru = 10.11 WHERE id = $1`,
        [tripId],
      );
      await expect(
        repository.findPublicPricePreview(tripId, 3),
      ).resolves.toMatchObject({
        estimatedUnitPrice: '10.11',
        estimatedTotal: '30.33',
      });
      await expect(counts(tx, tripId)).resolves.toEqual(before);
    });
  });

  it('matches the layout and reservations, exposes only exact-seat gender, and treats expired holds as read-only available seats', async () => {
    await inRollback(async (tx, fixture) => {
      const tripId = fixture.eligibleTripIds[0];
      const bookings = buildBookingService(tx);
      const mixed = await bookings.createPassengerBooking(
        fixture.owner,
        'availability-mixed-gender',
        {
          tripId,
          passengers: [
            {
              fullName: 'Private Female',
              phone: '+22236000001',
              documentNumber: 'SECRET-F',
              gender: PassengerGender.Female,
              seatId: '1A',
            },
            {
              fullName: 'Private Male',
              phone: '+22236000002',
              documentNumber: 'SECRET-M',
              gender: PassengerGender.Male,
              seatId: '1B',
            },
          ],
        },
      );
      expect(
        mixed.passengers.map((passenger) => [
          passenger.seatId,
          passenger.gender,
        ]),
      ).toEqual([
        ['1A', 'FEMALE'],
        ['1B', 'MALE'],
      ]);
      await tx.query(
        `UPDATE public.seat_reservations SET status = 'CONFIRMED'
         WHERE booking_id = $1`,
        [mixed.id],
      );

      const unspecified = await bookings.createPassengerBooking(
        fixture.owner,
        'availability-unspecified-gender',
        {
          tripId,
          passengers: [{ fullName: 'No Gender', seatId: '2A' }],
        },
      );
      expect(unspecified.passengers[0].gender).toBe('UNSPECIFIED');
      const passenger = await tx.query<{ id: string; gender: string }>(
        `SELECT id::text, gender::text FROM public.passengers
         WHERE booking_id = $1`,
        [unspecified.id],
      );
      expect(passenger.rows[0].gender).toBe('UNSPECIFIED');

      const expired = await bookings.createPassengerBooking(
        fixture.owner,
        'availability-expired-hold',
        {
          tripId,
          passengers: [
            {
              fullName: 'Expired Secret',
              documentNumber: 'EXPIRED-SECRET',
              gender: PassengerGender.Female,
              seatId: '2B',
            },
          ],
        },
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

      const repository = new PostgresAvailabilityRepository(tx);
      const before = await counts(tx, tripId);
      const stateBefore = await tx.query<{
        booking_status: string;
        reservation_status: string;
      }>(
        `SELECT booking.status::text AS booking_status,
                reservation.status::text AS reservation_status
         FROM public.bookings booking
         JOIN public.seat_reservations reservation
           ON reservation.booking_id = booking.id
         WHERE booking.id = $1`,
        [expired.id],
      );

      const availability = await repository.findPublicAvailability(tripId);
      const search = await repository.searchPublicTrips(
        searchFilter(fixture),
        resolvePagination(),
      );
      await repository.findPublicPricePreview(tripId, 2);

      expect(availability).toEqual({
        tripId,
        totalSeatCount: 4,
        availableSeatCount: 1,
        seats: [
          {
            seatId: '1A',
            label: '1A',
            status: 'BOOKED',
            occupantGender: 'FEMALE',
          },
          {
            seatId: '1B',
            label: '1B',
            status: 'BOOKED',
            occupantGender: 'MALE',
          },
          {
            seatId: '2A',
            label: '2A',
            status: 'HELD',
            occupantGender: 'UNSPECIFIED',
          },
          {
            seatId: '2B',
            label: '2B',
            status: 'AVAILABLE',
            occupantGender: null,
          },
        ],
      });
      expect(
        search.items.find((trip) => trip.tripId === tripId)?.availableSeatCount,
      ).toBe(1);
      expect(JSON.stringify(availability)).not.toMatch(
        /Private Female|Private Male|No Gender|Expired Secret|3600000|SECRET/i,
      );
      expect(
        availability?.seats.every(
          (seat) =>
            Object.keys(seat).sort().join(',') ===
            'label,occupantGender,seatId,status',
        ),
      ).toBe(true);
      await expect(counts(tx, tripId)).resolves.toEqual(before);
      const stateAfter = await tx.query<{
        booking_status: string;
        reservation_status: string;
      }>(
        `SELECT booking.status::text AS booking_status,
                reservation.status::text AS reservation_status
         FROM public.bookings booking
         JOIN public.seat_reservations reservation
           ON reservation.booking_id = booking.id
         WHERE booking.id = $1`,
        [expired.id],
      );
      expect(stateBefore.rows[0]).toEqual({
        booking_status: 'HELD',
        reservation_status: 'HELD',
      });
      expect(stateAfter.rows[0]).toEqual(stateBefore.rows[0]);
    });
  });

  it('rejects mutation of the persisted passenger gender snapshot', async () => {
    await inRollback(async (tx, fixture) => {
      const booking = await buildBookingService(tx).createPassengerBooking(
        fixture.owner,
        'availability-immutable-gender',
        {
          tripId: fixture.eligibleTripIds[0],
          passengers: [{ fullName: 'Immutable Gender', seatId: '1A' }],
        },
      );
      const passenger = await tx.query<{ id: string; gender: string }>(
        `SELECT id::text, gender::text FROM public.passengers
         WHERE booking_id = $1`,
        [booking.id],
      );
      expect(passenger.rows[0].gender).toBe('UNSPECIFIED');

      await tx.query(`SAVEPOINT immutable_gender`);
      await expect(
        tx.query(`UPDATE public.passengers SET gender = 'MALE' WHERE id = $1`, [
          passenger.rows[0].id,
        ]),
      ).rejects.toBeDefined();
      await tx.query(`ROLLBACK TO SAVEPOINT immutable_gender`);
    });
  });

  it('wires the public controller and real PostgreSQL adapter without Phase 12 payment providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const opts = { strict: false } as const;

    expect(moduleRef.get(AvailabilityController, opts)).toBeInstanceOf(
      AvailabilityController,
    );
    expect(moduleRef.get(AvailabilityService, opts)).toBeInstanceOf(
      AvailabilityService,
    );
    expect(moduleRef.get(AVAILABILITY_REPOSITORY, opts)).toBeInstanceOf(
      PostgresAvailabilityRepository,
    );

    const providers = (Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AvailabilityModule,
    ) ?? []) as unknown[];
    const providerNames = providers.flatMap((provider) => {
      if (typeof provider === 'function') return [provider.name];
      const definition = provider as { provide?: unknown; useClass?: unknown };
      return [
        typeof definition.provide === 'symbol'
          ? (definition.provide.description ?? '')
          : String(definition.provide ?? ''),
        typeof definition.useClass === 'function'
          ? definition.useClass.name
          : '',
      ];
    });
    expect(providerNames.join(' ')).not.toMatch(/payment|provider.*payment/i);

    await moduleRef.close();
  });
});
