import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import {
  DatabaseConnectionError,
  TransactionManager,
} from '../src/infrastructure/database';
import { AUTH_KEY_RESOLVER } from '../src/modules/auth/jwks-key-resolver.provider';
import {
  CreatePassengerBookingUseCase,
  ExpireBookingUseCase,
} from '../src/modules/bookings/booking.use-cases';
import {
  CompanyBookingsController,
  PassengerBookingsController,
} from '../src/modules/bookings/bookings.controller';
import { BOOKINGS_REPOSITORY } from '../src/modules/bookings/bookings.repository';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import {
  type BookingEvent,
  PassengerGender,
} from '../src/modules/bookings/booking.types';
import { IDENTITY_REPOSITORY } from '../src/modules/identity/identity.repository';
import { MembershipRole } from '../src/modules/identity/membership-role';
import {
  generateTestKey,
  localJwksResolver,
  signTestToken,
  type TestSigningKey,
} from './support/auth-test-keys';
import { InMemoryBookingsRepository } from './support/in-memory-bookings.repository';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';

const inlineTransactions = {
  run: <T>(work: (tx: never) => Promise<T>): Promise<T> => work({} as never),
};

describe('Bookings (e2e)', () => {
  const ISSUER = 'http://127.0.0.1:54321/auth/v1';
  const AUDIENCE = 'authenticated';
  const PASSENGER = '11111111-1111-4111-8111-111111111111';
  const OTHER_PASSENGER = '22222222-2222-4222-8222-222222222222';
  const AGENT = '33333333-3333-4333-8333-333333333333';
  const CROSS_PRODUCT_AGENT = '44444444-4444-4444-8444-444444444444';
  const OTHER_COMPANY_MANAGER = '55555555-5555-4555-8555-555555555555';

  let app: INestApplication;
  let moduleRef: TestingModule;
  let key: TestSigningKey;
  let bookings: InMemoryBookingsRepository;

  const auth = (subject: string) =>
    signTestToken(key, { issuer: ISSUER, audience: AUDIENCE, subject }).then(
      (token) => `Bearer ${token}`,
    );
  const payload = (seatId = '1A') => ({
    tripId: '100',
    passengers: [
      {
        fullName: 'Passenger One',
        gender: PassengerGender.Unspecified,
        seatId,
      },
    ],
  });

  beforeAll(async () => {
    key = await generateTestKey('bookings-e2e', 'ES256');
    bookings = new InMemoryBookingsRepository();
    const identity = new InMemoryIdentityRepository();

    bookings.addTrip();
    for (const [userId, name] of [
      [PASSENGER, 'Passenger'],
      [OTHER_PASSENGER, 'Other Passenger'],
      [AGENT, 'Agent'],
      [CROSS_PRODUCT_AGENT, 'Cross Product Agent'],
      [OTHER_COMPANY_MANAGER, 'Other Company Manager'],
    ]) {
      identity.addProfile(userId, name);
    }
    identity.addCompany('10', 'Voyagi');
    identity.addCompany('20', 'Other Company');

    const memberships = [
      {
        id: '1',
        userId: AGENT,
        companyId: '10',
        branchId: '1',
        role: MembershipRole.Agent,
      },
      {
        id: '2',
        userId: CROSS_PRODUCT_AGENT,
        companyId: '10',
        branchId: '1',
        role: MembershipRole.Agent,
      },
      {
        id: '3',
        userId: CROSS_PRODUCT_AGENT,
        companyId: '10',
        branchId: '2',
        role: MembershipRole.BranchEmployee,
      },
      {
        id: '4',
        userId: OTHER_COMPANY_MANAGER,
        companyId: '20',
        role: MembershipRole.CompanyManager,
      },
    ];
    for (const membership of memberships) {
      identity.addMembership(membership);
      bookings.addMembership(membership);
    }

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_KEY_RESOLVER)
      .useValue(localJwksResolver(key))
      .overrideProvider(IDENTITY_REPOSITORY)
      .useValue(identity)
      .overrideProvider(BOOKINGS_REPOSITORY)
      .useValue(bookings)
      .overrideProvider(TransactionManager)
      .useValue(inlineTransactions)
      .compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated booking requests with 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .send(payload());

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('creates a passenger booking, replays an identical request, and conflicts on changed payload', async () => {
    const token = await auth(PASSENGER);
    const first = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', token)
      .set('Idempotency-Key', 'passenger-retry')
      .send(payload('1A'));
    const replay = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', token)
      .set('Idempotency-Key', 'passenger-retry')
      .send(payload('1A'));
    const conflict = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', token)
      .set('Idempotency-Key', 'passenger-retry')
      .send(payload('1B'));

    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      tripId: '100',
      companyId: '10',
      status: 'HELD',
      totalAmount: '500.00',
      passengers: [{ fullName: 'Passenger One', seatId: '1A' }],
    });
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('enforces booking DTO and domain boundaries and defaults omitted gender', async () => {
    const token = await auth(OTHER_PASSENGER);
    const maximum = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', token)
      .set('Idempotency-Key', 'k'.repeat(255))
      .send({
        tripId: '100',
        passengers: [
          {
            fullName: 'N'.repeat(200),
            documentNumber: 'D'.repeat(100),
            seatId: 'S'.repeat(20),
          },
        ],
      });
    expect(maximum.status).toBe(201);
    expect(maximum.body.data.passengers[0].gender).toBe('UNSPECIFIED');

    const invalidBodies = [
      { ...payload('limit-name'), passengers: [{ ...payload().passengers[0], fullName: 'N'.repeat(201), seatId: 'limit-name' }] },
      { ...payload('limit-document'), passengers: [{ ...payload().passengers[0], documentNumber: 'D'.repeat(101), seatId: 'limit-document' }] },
      { ...payload('S'.repeat(21)), passengers: [{ ...payload().passengers[0], seatId: 'S'.repeat(21) }] },
      { ...payload('bad-phone'), passengers: [{ ...payload().passengers[0], phone: 'not-a-phone', seatId: 'bad-phone' }] },
      {
        tripId: '100',
        passengers: Array.from({ length: 21 }, (_, index) => ({
          fullName: `Passenger ${index}`,
          gender: PassengerGender.Unspecified,
          seatId: `capacity-${index}`,
        })),
      },
    ];
    for (const [index, body] of invalidBodies.entries()) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', token)
        .set('Idempotency-Key', `invalid-boundary-${index}`)
        .send(body);
      expect(response.status).toBe(400);
    }

    const longKey = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', token)
      .set('Idempotency-Key', 'k'.repeat(256))
      .send(payload('long-key'));
    expect(longKey.status).toBe(400);

    const oversizedTrip = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', token)
      .set('Idempotency-Key', 'oversized-trip')
      .send({ ...payload('oversized-trip'), tripId: '9223372036854775808' });
    expect(oversizedTrip.status).toBe(422);
  });

  it('cancels an owned hold, exposes its event, and rejects a second cancellation', async () => {
    const token = await auth(PASSENGER);
    const created = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', token)
      .set('Idempotency-Key', 'cancel-booking')
      .send(payload('2A'));
    const bookingId = created.body.data.id as string;

    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', token);
    const events = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${bookingId}/events`)
      .set('Authorization', token);
    const repeated = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', token);

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({
      status: 'CANCELLED',
      version: 2,
    });
    expect(events.status).toBe(200);
    expect(
      events.body.data.map((event: { eventType: string }) => event.eventType),
    ).toEqual(['CANCELLED', 'BOOKING_CREATED']);
    expect(repeated.status).toBe(409);
    expect(repeated.body.error.code).toBe('BOOKING_NOT_CANCELLABLE');
  });

  it('serializes booking events through an exact public allowlist', async () => {
    const token = await auth(PASSENGER);
    const created = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', token)
      .set('Idempotency-Key', 'safe-event-response')
      .send(payload('2B'));
    const bookingId = created.body.data.id as string;
    const secret = 'sensitive-event-metadata';
    jest.spyOn(bookings, 'listEventsForOwner').mockResolvedValueOnce({
      items: [
        {
          id: '999',
          eventType: 'BOOKING_CREATED',
          eventTime: new Date('2026-07-22T12:00:00.000Z'),
          actorUserId: OTHER_PASSENGER,
          metadata: { secret },
        } as unknown as BookingEvent,
      ],
      total: 1,
    });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${bookingId}/events`)
      .set('Authorization', token);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      {
        id: '999',
        eventType: 'BOOKING_CREATED',
        eventTime: '2026-07-22T12:00:00.000Z',
      },
    ]);
    expect(Object.keys(response.body.data[0]).sort()).toEqual([
      'eventTime',
      'eventType',
      'id',
    ]);
    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(JSON.stringify(response.body)).not.toContain(OTHER_PASSENGER);
  });

  it('denies an agent creating in a branch outside the agent membership', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/companies/10/bookings')
      .set('Authorization', await auth(AGENT))
      .set('Idempotency-Key', 'wrong-branch')
      .send({ ...payload('3A'), branchId: '2' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('does not let an agent use passenger-owner routes for an agent booking', async () => {
    const token = await auth(AGENT);
    const created = await request(app.getHttpServer())
      .post('/api/v1/companies/10/bookings')
      .set('Authorization', token)
      .set('Idempotency-Key', 'agent-not-passenger-owner')
      .send({ ...payload('3C'), branchId: '1' });
    expect(created.status).toBe(201);

    const read = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${created.body.data.id as string}`)
      .set('Authorization', token);
    const events = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${created.body.data.id as string}/events`)
      .set('Authorization', token);
    const list = await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .set('Authorization', token);
    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${created.body.data.id as string}/cancel`)
      .set('Authorization', token);
    expect(read.status).toBe(404);
    expect(events.status).toBe(404);
    expect(list.status).toBe(200);
    expect(
      list.body.data.map((booking: { id: string }) => booking.id),
    ).not.toContain(created.body.data.id);
    expect(cancelled.status).toBe(404);
  });

  it('does not cross-product Branch A create permission with Branch B read-only membership', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/companies/10/bookings')
      .set('Authorization', await auth(CROSS_PRODUCT_AGENT))
      .set('Idempotency-Key', 'cross-product')
      .send({ ...payload('3B'), branchId: '2' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('returns the same safe 404 for another passenger and a wrong-company resource', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', await auth(PASSENGER))
      .set('Idempotency-Key', 'hidden-booking')
      .send(payload('4A'));
    const bookingId = created.body.data.id as string;

    const wrongOwner = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', await auth(OTHER_PASSENGER));
    const wrongCompany = await request(app.getHttpServer())
      .get(`/api/v1/companies/20/bookings/${bookingId}`)
      .set('Authorization', await auth(OTHER_COMPANY_MANAGER));

    for (const response of [wrongOwner, wrongCompany]) {
      expect(response.status).toBe(404);
      expect(response.body.error).toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: 'The requested booking was not found.',
      });
      expect(JSON.stringify(response.body)).not.toContain('companyId');
    }
  });

  it('surfaces a booking repository outage as 503', async () => {
    bookings.failNextWith(new DatabaseConnectionError());
    const response = await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .set('Authorization', await auth(PASSENGER));

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('DEPENDENCY_FAILURE');
  });

  it('wires both booking controllers, service, use cases, repository override, and transaction override', () => {
    const opts = { strict: false } as const;
    expect(moduleRef.get(PassengerBookingsController, opts)).toBeInstanceOf(
      PassengerBookingsController,
    );
    expect(moduleRef.get(CompanyBookingsController, opts)).toBeInstanceOf(
      CompanyBookingsController,
    );
    expect(moduleRef.get(BookingsService, opts)).toBeInstanceOf(
      BookingsService,
    );
    expect(moduleRef.get(CreatePassengerBookingUseCase, opts)).toBeInstanceOf(
      CreatePassengerBookingUseCase,
    );
    expect(moduleRef.get(ExpireBookingUseCase, opts)).toBeInstanceOf(
      ExpireBookingUseCase,
    );
    expect(moduleRef.get(BOOKINGS_REPOSITORY, opts)).toBe(bookings);
    expect(moduleRef.get(TransactionManager, opts)).toBe(inlineTransactions);
  });
});
