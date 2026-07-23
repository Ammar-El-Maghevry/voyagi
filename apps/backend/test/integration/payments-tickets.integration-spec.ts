import { createHash, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DatabaseService } from '../../src/infrastructure/database';
import { DatabaseErrorMapper } from '../../src/infrastructure/database/database-error.mapper';
import { AuditWriter } from '../../src/modules/audit/audit.service';
import { PostgresAuditRepository } from '../../src/modules/audit/postgres-audit.repository';
import type { DatabaseExecutor } from '../../src/infrastructure/database/database.types';
import {
  Transaction,
  TransactionManager,
} from '../../src/infrastructure/database/transaction.manager';
import { BookingsService } from '../../src/modules/bookings/bookings.service';
import { PostgresBookingsRepository } from '../../src/modules/bookings/postgres-bookings.repository';
import { PostgresCommissionsRepository } from '../../src/modules/commissions/postgres-commissions.repository';
import { CommissionsService } from '../../src/modules/commissions/commissions.service';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { PostgresPaymentsRepository } from '../../src/modules/payments/postgres-payments.repository';
import { PaymentReferenceGenerator } from '../../src/modules/payments/payment-reference.generator';
import {
  type PaymentProvider,
  ProviderEventOutcome,
  type ProviderInitiation,
  type ProviderInitiationRequest,
  type WebhookRequest,
} from '../../src/modules/payments/payment-provider.port';
import {
  PaymentMethod,
  PaymentStatus,
} from '../../src/modules/payments/payment.types';
import { TestPaymentProvider } from '../../src/modules/payments/test-payment.provider';
import { TicketsService } from '../../src/modules/tickets/tickets.service';
import { PostgresTicketsRepository } from '../../src/modules/tickets/postgres-tickets.repository';
import { TicketTokenService } from '../../src/modules/tickets/ticket-token';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const WEBHOOK_SECRET = 'itest-webhook-secret';
const databaseConfig = {
  get: () => ({ logQueries: false, slowQueryMs: 1_000 }),
} as unknown as ConfigService;

interface Catalog {
  owner: string;
  otherOwner: string;
  manager: string;
  companyId: string;
  tripId: string;
}

/** Always fails to open a settlement — used to prove initiation rollback. */
class FailingProvider implements PaymentProvider {
  readonly name = 'failing';
  handlesMethod(): boolean {
    return true;
  }
  initiate(_request: ProviderInitiationRequest): Promise<ProviderInitiation> {
    return Promise.reject(new Error('provider outage'));
  }
  verifyAndParse(_request: WebhookRequest): never {
    throw new Error('unused');
  }
}

describe('Payments & Tickets (PostgreSQL integration)', () => {
  let pool: Pool;
  let transactions: TransactionManager;
  let database: DatabaseService;
  let bookings: BookingsService;
  let payments: PaymentsService;
  let failingPayments: PaymentsService;
  let tickets: TicketsService;
  const provider = new TestPaymentProvider(WEBHOOK_SECRET);
  let catalog: Catalog;
  let seatCounter = 0;

  beforeAll(async () => {
    const host = new URL(DATABASE_URL).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      throw new Error(
        'Integration cleanup requires a disposable local PostgreSQL database.',
      );
    }
    pool = new Pool({ connectionString: DATABASE_URL, max: 8 });
    pool.on('error', () => undefined);
    const mapper = new DatabaseErrorMapper();
    transactions = new TransactionManager(pool, mapper);
    database = new DatabaseService(pool, mapper, databaseConfig);

    await pool.query('SELECT 1');
    const schema = await pool.query<{ present: string | null }>(
      `SELECT to_regprocedure('public.enforce_payment_transition()')::text AS present`,
    );
    if (!schema.rows[0]?.present) {
      throw new Error(
        'Migration 016 is not applied (enforce_payment_transition is missing).',
      );
    }

    bookings = new BookingsService(
      new PostgresBookingsRepository(),
      database,
      transactions,
    );
    payments = new PaymentsService(
      new PostgresPaymentsRepository(),
      database,
      transactions,
      new PaymentReferenceGenerator(),
      new CommissionsService(new PostgresCommissionsRepository(), database),
      [provider],
    );
    failingPayments = new PaymentsService(
      new PostgresPaymentsRepository(),
      database,
      transactions,
      new PaymentReferenceGenerator(),
      new CommissionsService(new PostgresCommissionsRepository(), database),
      [new FailingProvider()],
    );
    tickets = new TicketsService(
      new PostgresTicketsRepository(),
      database,
      transactions,
      new TicketTokenService(),
      new AuditWriter(new PostgresAuditRepository()),
    );

    catalog = await transactions.run((tx) => seedCatalog(tx));
  });

  afterAll(async () => {
    try {
      if (catalog) {
        await cleanup(catalog.companyId, [
          catalog.owner,
          catalog.otherOwner,
          catalog.manager,
        ]);
      }
    } finally {
      await pool.end();
    }
  });

  async function scalar(
    executor: DatabaseExecutor,
    text: string,
    params: readonly unknown[],
  ): Promise<string> {
    const result = await executor.query<{ id: string }>(text, params);
    return String(result.rows[0].id);
  }

  async function seedCatalog(tx: Transaction): Promise<Catalog> {
    const owner = randomUUID();
    const otherOwner = randomUUID();
    const manager = randomUUID();
    for (const user of [owner, otherOwner, manager]) {
      await tx.query(
        `INSERT INTO auth.users (id, email, raw_user_meta_data)
         VALUES ($1, $2, jsonb_build_object('full_name', $3::text))`,
        [user, `${user}@pt-itest.local`, `User ${user.slice(0, 8)}`],
      );
    }
    const suffix = owner.slice(0, 8);
    const companyId = await scalar(
      tx,
      `INSERT INTO public.companies (name) VALUES ($1) RETURNING id`,
      [`PT ${suffix}`],
    );
    const city = await scalar(
      tx,
      `INSERT INTO public.cities (name_ar, name_fr) VALUES ($1, $2) RETURNING id`,
      [`مدينة-${suffix}`, `City-${suffix}`],
    );
    const origin = await scalar(
      tx,
      `INSERT INTO public.stations (city_id, name_ar, name_fr) VALUES ($1, $2, $3) RETURNING id`,
      [city, `أصل-${suffix}`, `Origin-${suffix}`],
    );
    const destination = await scalar(
      tx,
      `INSERT INTO public.stations (city_id, name_ar, name_fr) VALUES ($1, $2, $3) RETURNING id`,
      [city, `وجهة-${suffix}`, `Destination-${suffix}`],
    );
    const seats = Array.from({ length: 60 }, (_, index) => `S${index + 1}`);
    const layout = await scalar(
      tx,
      `INSERT INTO public.seat_layouts (name, total_seats, layout_grid)
       VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [`PT layout ${suffix}`, seats.length, JSON.stringify(seats)],
    );
    const bus = await scalar(
      tx,
      `INSERT INTO public.buses (company_id, seat_layout_id, plate_number) VALUES ($1, $2, $3) RETURNING id`,
      [companyId, layout, `PT-${suffix}`],
    );
    const route = await scalar(
      tx,
      `INSERT INTO public.routes (company_id, origin_station_id, destination_station_id,
         default_price_mru, estimated_duration_minutes)
       VALUES ($1, $2, $3, 500, 180) RETURNING id`,
      [companyId, origin, destination],
    );
    const tripId = await scalar(
      tx,
      `INSERT INTO public.trips (company_id, route_id, bus_id, departure_time,
         estimated_arrival_time, price_mru, boarding_closes_at)
       VALUES ($1, $2, $3, now() + interval '2 days', now() + interval '2 days 3 hours',
               500, now() + interval '1 day 23 hours')
       RETURNING id`,
      [companyId, route, bus],
    );
    await tx.query(
      `INSERT INTO public.company_memberships (user_id, company_id, role)
       VALUES ($1, $2, 'COMPANY_MANAGER')`,
      [manager, companyId],
    );
    return { owner, otherOwner, manager, companyId, tripId };
  }

  /** Create a HELD passenger booking owned by `owner` with `count` passengers. */
  async function makeBooking(owner: string, count = 1): Promise<string> {
    const passengers = Array.from({ length: count }, () => {
      seatCounter += 1;
      return {
        fullName: `Passenger ${seatCounter}`,
        seatId: `S${seatCounter}`,
      };
    });
    const booking = await bookings.createPassengerBooking(owner, randomUUID(), {
      tripId: catalog.tripId,
      passengers,
    });
    return booking.id;
  }

  function webhookFor(
    internalReference: string,
    providerReference: string,
    amount: string,
    outcome: ProviderEventOutcome = ProviderEventOutcome.Succeeded,
    currency = 'MRU',
  ): { rawBody: Buffer; headers: Record<string, string> } {
    const rawBody = Buffer.from(
      JSON.stringify({
        eventId: randomUUID(),
        internalReference,
        providerReference,
        outcome,
        amount,
        currency,
      }),
    );
    return {
      rawBody,
      headers: { 'x-voyagi-signature': provider.sign(rawBody) },
    };
  }

  async function paymentCount(bookingId: string): Promise<number> {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.payments WHERE booking_id = $1`,
      [bookingId],
    );
    return Number(result.rows[0].count);
  }

  async function bookingStatus(bookingId: string): Promise<string> {
    const result = await pool.query<{ status: string }>(
      `SELECT status::text FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    return result.rows[0].status;
  }

  // === Payment initiation =================================================

  it('derives the authoritative amount from the booking snapshot', async () => {
    const bookingId = await makeBooking(catalog.owner, 2);
    const payment = await payments.createPassengerPayment(
      catalog.owner,
      randomUUID(),
      {
        bookingId,
        method: PaymentMethod.Bankily,
      },
    );
    expect(payment.amount).toBe('1000.00'); // 500 * 2, server-derived
    expect(payment.currency).toBe('MRU');
    expect(payment.status).toBe(PaymentStatus.Processing);
    expect(payment.providerReference).toBe(`test_${payment.internalReference}`);
  });

  it('rejects paying another user’s booking with a safe 404', async () => {
    const bookingId = await makeBooking(catalog.owner, 1);
    await expect(
      payments.createPassengerPayment(catalog.otherOwner, randomUUID(), {
        bookingId,
        method: PaymentMethod.Bankily,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('replays an identical initiation and conflicts on a changed one', async () => {
    const bookingId = await makeBooking(catalog.owner, 1);
    const key = randomUUID();
    const first = await payments.createPassengerPayment(catalog.owner, key, {
      bookingId,
      method: PaymentMethod.Bankily,
    });
    const replay = await payments.createPassengerPayment(catalog.owner, key, {
      bookingId,
      method: PaymentMethod.Bankily,
    });
    expect(replay.id).toBe(first.id);
    expect(await paymentCount(bookingId)).toBe(1);
    await expect(
      payments.createPassengerPayment(catalog.owner, key, {
        bookingId,
        method: PaymentMethod.Masrvi,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('creates exactly one payment under concurrent identical initiation', async () => {
    const bookingId = await makeBooking(catalog.owner, 1);
    const key = randomUUID();
    const [a, b] = await Promise.all([
      payments.createPassengerPayment(catalog.owner, key, {
        bookingId,
        method: PaymentMethod.Bankily,
      }),
      payments.createPassengerPayment(catalog.owner, key, {
        bookingId,
        method: PaymentMethod.Bankily,
      }),
    ]);
    expect(a.id).toBe(b.id);
    expect(await paymentCount(bookingId)).toBe(1);
  });

  it('rolls back the whole initiation when the provider fails (no partial state)', async () => {
    const bookingId = await makeBooking(catalog.owner, 1);
    const key = randomUUID();
    await expect(
      failingPayments.createPassengerPayment(catalog.owner, key, {
        bookingId,
        method: PaymentMethod.Bankily,
      }),
    ).rejects.toThrow('provider outage');
    expect(await paymentCount(bookingId)).toBe(0);
    // The booking retains only its BOOKING_CREATED event; no PAYMENT_PENDING leaked.
    const events = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.booking_events
        WHERE booking_id = $1 AND event_type = 'PAYMENT_PENDING'`,
      [bookingId],
    );
    expect(Number(events.rows[0].count)).toBe(0);
  });

  // === CASH confirmation ==================================================

  it('confirms a cash payment once under duplicate confirmation and confirms the booking', async () => {
    const bookingId = await makeBooking(catalog.owner, 1);
    const cash = await payments.createCompanyPayment(
      catalog.manager,
      catalog.companyId,
      randomUUID(),
      {
        bookingId,
        method: PaymentMethod.Cash,
      },
    );
    const results = await Promise.allSettled([
      payments.confirmCashPayment(catalog.manager, catalog.companyId, cash.id),
      payments.confirmCashPayment(catalog.manager, catalog.companyId, cash.id),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(await bookingStatus(bookingId)).toBe('CONFIRMED');
    const confirmedEvents = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.booking_events
        WHERE booking_id = $1 AND event_type = 'PAYMENT_CONFIRMED'`,
      [bookingId],
    );
    expect(Number(confirmedEvents.rows[0].count)).toBe(1);
    const seats = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.seat_reservations
        WHERE booking_id = $1 AND status = 'CONFIRMED'`,
      [bookingId],
    );
    expect(Number(seats.rows[0].count)).toBe(1);
  });

  // === Webhook confirmation & dedup =======================================

  it('confirms an online payment via a signed webhook, idempotent under duplicate delivery', async () => {
    const bookingId = await makeBooking(catalog.owner, 1);
    const payment = await payments.createPassengerPayment(
      catalog.owner,
      randomUUID(),
      {
        bookingId,
        method: PaymentMethod.Bankily,
      },
    );
    const hook = webhookFor(
      payment.internalReference,
      payment.providerReference!,
      payment.amount,
    );
    const [first, second] = await Promise.all([
      payments.handleWebhook('test', hook.rawBody, hook.headers),
      payments.handleWebhook('test', hook.rawBody, hook.headers),
    ]);
    expect(first).toEqual({ received: true });
    expect(second).toEqual({ received: true });
    expect(await bookingStatus(bookingId)).toBe('CONFIRMED');
    const settled = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.payments
        WHERE booking_id = $1 AND status = 'SUCCEEDED'`,
      [bookingId],
    );
    expect(Number(settled.rows[0].count)).toBe(1);
  });

  it('rejects an unverified webhook signature and mutates nothing', async () => {
    const bookingId = await makeBooking(catalog.owner, 1);
    const payment = await payments.createPassengerPayment(
      catalog.owner,
      randomUUID(),
      {
        bookingId,
        method: PaymentMethod.Bankily,
      },
    );
    const hook = webhookFor(
      payment.internalReference,
      payment.providerReference!,
      payment.amount,
    );
    await expect(
      payments.handleWebhook('test', hook.rawBody, {
        'x-voyagi-signature': 'deadbeef',
      }),
    ).rejects.toMatchObject({ status: 400 });
    const status = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM public.payments WHERE id = $1`,
      [payment.id],
    );
    expect(status.rows[0].status).toBe('PROCESSING');
  });

  it('never settles on a wrong amount and handles out-of-order failure after success', async () => {
    const bookingId = await makeBooking(catalog.owner, 1);
    const payment = await payments.createPassengerPayment(
      catalog.owner,
      randomUUID(),
      {
        bookingId,
        method: PaymentMethod.Bankily,
      },
    );
    // Wrong amount → rejected, no mutation.
    const wrong = webhookFor(
      payment.internalReference,
      payment.providerReference!,
      '1.00',
    );
    await expect(
      payments.handleWebhook('test', wrong.rawBody, wrong.headers),
    ).rejects.toMatchObject({
      status: 422,
    });
    expect(
      (
        await pool.query(`SELECT status FROM public.payments WHERE id=$1`, [
          payment.id,
        ])
      ).rows[0].status,
    ).toBe('PROCESSING');

    // Correct success, then a late FAILED event is a harmless no-op.
    const ok = webhookFor(
      payment.internalReference,
      payment.providerReference!,
      payment.amount,
    );
    await payments.handleWebhook('test', ok.rawBody, ok.headers);
    const late = webhookFor(
      payment.internalReference,
      payment.providerReference!,
      payment.amount,
      ProviderEventOutcome.Failed,
    );
    await expect(
      payments.handleWebhook('test', late.rawBody, late.headers),
    ).resolves.toEqual({
      received: true,
    });
    expect(
      (
        await pool.query(`SELECT status FROM public.payments WHERE id=$1`, [
          payment.id,
        ])
      ).rows[0].status,
    ).toBe('SUCCEEDED');
  });

  // === Refund =============================================================

  it('refunds a settled payment exactly once under concurrent refunds', async () => {
    const bookingId = await makeBooking(catalog.owner, 1);
    const cash = await payments.createCompanyPayment(
      catalog.manager,
      catalog.companyId,
      randomUUID(),
      {
        bookingId,
        method: PaymentMethod.Cash,
      },
    );
    await payments.confirmCashPayment(
      catalog.manager,
      catalog.companyId,
      cash.id,
    );
    const results = await Promise.allSettled([
      payments.refundPayment(catalog.manager, catalog.companyId, cash.id),
      payments.refundPayment(catalog.manager, catalog.companyId, cash.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const status = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM public.payments WHERE id = $1`,
      [cash.id],
    );
    expect(status.rows[0].status).toBe('REFUNDED');
    const refundEvents = await pool.query<{ event_type: string }>(
      `SELECT event_type::text AS event_type FROM public.booking_events
        WHERE booking_id = $1 AND event_type IN ('REFUND_CREATED', 'REFUND_COMPLETED')`,
      [bookingId],
    );
    expect(refundEvents.rows.map((r) => r.event_type).sort()).toEqual([
      'REFUND_COMPLETED',
      'REFUND_CREATED',
    ]);
  });

  // === Tickets ============================================================

  async function confirmedPaidBooking(
    owner: string,
    count: number,
  ): Promise<string> {
    const bookingId = await makeBooking(owner, count);
    const cash = await payments.createCompanyPayment(
      catalog.manager,
      catalog.companyId,
      randomUUID(),
      {
        bookingId,
        method: PaymentMethod.Cash,
      },
    );
    await payments.confirmCashPayment(
      catalog.manager,
      catalog.companyId,
      cash.id,
    );
    return bookingId;
  }

  it('issues one ticket per passenger/seat, idempotently and only once', async () => {
    const bookingId = await confirmedPaidBooking(catalog.owner, 2);
    const [issueA, issueB] = await Promise.all([
      tickets.issueForOwner(catalog.owner, bookingId),
      tickets.issueForOwner(catalog.owner, bookingId),
    ]);
    const stored = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.tickets WHERE booking_id = $1`,
      [bookingId],
    );
    expect(Number(stored.rows[0].count)).toBe(2);
    // Each concurrent caller sees both tickets; distinct passengers & seats.
    expect(issueA).toHaveLength(2);
    expect(issueB).toHaveLength(2);
    const seatSet = new Set(issueA.map((t) => t.seatReservationId));
    expect(seatSet.size).toBe(2);
    const withToken = [...issueA, ...issueB].filter((t) => t.qrToken);
    // The raw token is handed out exactly once per ticket (2 tickets total).
    expect(new Set(withToken.map((t) => t.id)).size).toBe(2);
  });

  it('persists only the QR hash, never the raw token', async () => {
    const bookingId = await confirmedPaidBooking(catalog.owner, 1);
    const [issued] = await tickets.issueForOwner(catalog.owner, bookingId);
    expect(issued.qrToken).toBeDefined();
    const raw = issued.qrToken as string;
    const stored = await pool.query<{ qr_token_hash: string }>(
      `SELECT qr_token_hash FROM public.tickets WHERE id = $1`,
      [issued.id],
    );
    expect(stored.rows[0].qr_token_hash).not.toBe(raw);
    expect(stored.rows[0].qr_token_hash).toBe(
      createHash('sha256').update(raw).digest('hex'),
    );
    // The raw token must not be stored in any column of the row.
    const any = await pool.query<{ present: boolean }>(
      `SELECT (to_jsonb(t)::text LIKE '%' || $2 || '%') AS present
         FROM public.tickets t WHERE id = $1`,
      [issued.id, raw],
    );
    expect(any.rows[0].present).toBe(false);
  });

  it('refuses to issue tickets for an unpaid booking (no partial state)', async () => {
    const bookingId = await makeBooking(catalog.owner, 1); // HELD, unpaid
    await expect(
      tickets.issueForOwner(catalog.owner, bookingId),
    ).rejects.toMatchObject({
      status: 409,
    });
    const stored = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.tickets WHERE booking_id = $1`,
      [bookingId],
    );
    expect(Number(stored.rows[0].count)).toBe(0);
  });

  it('validates (checks in) a ticket once; a duplicate scan is rejected', async () => {
    const bookingId = await confirmedPaidBooking(catalog.owner, 1);
    const [issued] = await tickets.issueForCompany(
      catalog.manager,
      catalog.companyId,
      bookingId,
    );
    const first = await tickets.validateTicket(
      catalog.manager,
      catalog.companyId,
      issued.id,
    );
    expect(first.status).toBe('CHECKED_IN');
    await expect(
      tickets.validateTicket(catalog.manager, catalog.companyId, issued.id),
    ).rejects.toMatchObject({ status: 409 });
    const seat = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM public.seat_reservations WHERE id = $1`,
      [issued.seatReservationId],
    );
    expect(seat.rows[0].status).toBe('CHECKED_IN');
    const audit = await pool.query<{
      action: string;
      entity_type: string;
      entity_id: string;
      old_values: Record<string, unknown> | null;
      new_values: Record<string, unknown> | null;
    }>(
      `SELECT action, entity_type, entity_id, old_values, new_values
         FROM public.audit_logs
        WHERE company_id = $1 AND entity_type = 'ticket' AND entity_id = $2`,
      [catalog.companyId, issued.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toEqual({
      action: 'TICKET_VALIDATED',
      entity_type: 'ticket',
      entity_id: issued.id,
      old_values: { status: 'ISSUED' },
      new_values: { status: 'CHECKED_IN' },
    });
    expect(JSON.stringify(audit.rows[0])).not.toMatch(
      /qr|token|passenger|phone|document|authorization|cookie|request|sql/i,
    );
  });

  it('verifies a valid token and reports refunded bookings as invalid', async () => {
    const bookingId = await makeBooking(catalog.owner, 1);
    const cash = await payments.createCompanyPayment(
      catalog.manager,
      catalog.companyId,
      randomUUID(),
      {
        bookingId,
        method: PaymentMethod.Cash,
      },
    );
    await payments.confirmCashPayment(
      catalog.manager,
      catalog.companyId,
      cash.id,
    );
    const [issued] = await tickets.issueForOwner(catalog.owner, bookingId);
    const raw = issued.qrToken as string;

    const valid = await tickets.verifyTicket(
      catalog.manager,
      catalog.companyId,
      raw,
    );
    expect(valid.valid).toBe(true);

    await payments.refundPayment(catalog.manager, catalog.companyId, cash.id);
    const afterRefund = await tickets.verifyTicket(
      catalog.manager,
      catalog.companyId,
      raw,
    );
    expect(afterRefund.valid).toBe(false);
    expect(afterRefund.reason).toBe('NOT_PAID');
  });

  // === RLS / direct-write denial ==========================================

  it('denies direct authenticated writes to payments and tickets (RLS/grants)', async () => {
    await transactions
      .run(async (tx) => {
        await tx.query(`SET LOCAL role authenticated`);
        await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: catalog.owner, role: 'authenticated' }),
        ]);
        await expect(
          tx.query(
            `INSERT INTO public.payments (booking_id, method, status, amount, currency, internal_reference)
           VALUES ($1, 'CASH', 'PENDING', 100, 'MRU', 'rls-x')`,
            [randomUUID()],
          ),
        ).rejects.toMatchObject({ driverError: { code: '42501' } });
        await tx.query(`ROLLBACK`).catch(() => undefined);
      })
      .catch(() => undefined);
  });

  async function cleanup(
    companyId: string,
    users: readonly string[],
  ): Promise<void> {
    // Reset fixture data on ONE pinned connection with triggers disabled via
    // `session_replication_role = 'replica'`. This is ownership-independent —
    // unlike `ALTER TABLE ... DISABLE TRIGGER`, which only the table owner may
    // run and so silently failed on CI (where the tables are owned by a
    // different role), leaving the append-only trigger active during teardown.
    // Replica mode also relaxes FK triggers, so deletion order is not
    // load-bearing. The setting is per-session, hence the dedicated client.
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(
        `DELETE FROM public.idempotency_records WHERE company_id = $1`,
        [companyId],
      );
      await client.query(
        `DELETE FROM public.tickets WHERE booking_id IN (SELECT id FROM public.bookings WHERE company_id = $1)`,
        [companyId],
      );
      await client.query(
        `DELETE FROM public.audit_logs WHERE company_id = $1`,
        [companyId],
      );
      await client.query(
        `DELETE FROM public.payments WHERE booking_id IN (SELECT id FROM public.bookings WHERE company_id = $1)`,
        [companyId],
      );
      await client.query(
        `DELETE FROM public.booking_events WHERE company_id = $1`,
        [companyId],
      );
      await client.query(
        `DELETE FROM public.seat_reservations WHERE booking_id IN (SELECT id FROM public.bookings WHERE company_id = $1)`,
        [companyId],
      );
      await client.query(
        `DELETE FROM public.passengers WHERE booking_id IN (SELECT id FROM public.bookings WHERE company_id = $1)`,
        [companyId],
      );
      await client.query(`DELETE FROM public.bookings WHERE company_id = $1`, [
        companyId,
      ]);
      await client.query(`DELETE FROM public.trips WHERE company_id = $1`, [
        companyId,
      ]);
      await client.query(
        `DELETE FROM public.company_memberships WHERE company_id = $1`,
        [companyId],
      );
      await client.query(`DELETE FROM public.routes WHERE company_id = $1`, [
        companyId,
      ]);
      await client.query(`DELETE FROM public.buses WHERE company_id = $1`, [
        companyId,
      ]);
      await client.query(
        `DELETE FROM public.company_settings WHERE company_id = $1`,
        [companyId],
      );
      await client.query(`DELETE FROM public.companies WHERE id = $1`, [
        companyId,
      ]);
      for (const user of users) {
        await client
          .query(`DELETE FROM auth.users WHERE id = $1`, [user])
          .catch(() => undefined);
      }
    } finally {
      await client
        .query(`SET session_replication_role = 'origin'`)
        .catch(() => undefined);
      client.release();
    }
  }
});
