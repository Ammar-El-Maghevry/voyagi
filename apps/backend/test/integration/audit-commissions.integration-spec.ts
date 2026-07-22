import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseErrorMapper } from '../../src/infrastructure/database/database-error.mapper';
import {
  Transaction,
  TransactionManager,
} from '../../src/infrastructure/database/transaction.manager';
import { PostgresAuditRepository } from '../../src/modules/audit/postgres-audit.repository';
import { CommissionStatus } from '../../src/modules/commissions/commission-status';
import { PostgresCommissionsRepository } from '../../src/modules/commissions/postgres-commissions.repository';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const UUID = '8a5e3649-17c2-4b0c-b858-7293f05458d2';

interface Seed {
  companyId: string;
  agentUserId: string;
  bookingId: string;
}

describe('Audit and commissions (PostgreSQL integration)', () => {
  let pool: Pool;
  let transactions: TransactionManager;
  let available = false;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    pool.on('error', () => undefined);
    transactions = new TransactionManager(pool, new DatabaseErrorMapper());

    try {
      await pool.query('SELECT 1');
      const schema = await pool.query<{
        commission: string | null;
        appendOnly: string | null;
      }>(
        `SELECT to_regprocedure('public.enforce_commission_transition()')::text AS commission,
                to_regprocedure('public.prevent_row_mutation()')::text AS "appendOnly"`,
      );
      if (!schema.rows[0]?.commission || !schema.rows[0]?.appendOnly) {
        throw new Error(
          'Migration 017 is not applied (audit/commission constraints are missing).',
        );
      }
      available = true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Migration 017'))
        throw error;
      console.warn(
        `[integration] No database at ${DATABASE_URL} - skipping audit/commission assertions.`,
      );
    }
  });

  afterAll(async () => {
    await pool.end();
  });

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
      if (error !== sentinel) throw error;
    }
  }

  async function scalar(
    tx: Transaction,
    text: string,
    params: readonly unknown[],
  ): Promise<string> {
    const result = await tx.query<{ id: string }>(text, params);
    return String(result.rows[0]!.id);
  }

  async function seedConfirmedAgentBooking(tx: Transaction): Promise<Seed> {
    const agentUserId = randomUUID();
    const suffix = agentUserId.slice(0, 8);
    await tx.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data)
       VALUES ($1, $2, jsonb_build_object('full_name', $3::text))`,
      [
        agentUserId,
        `${agentUserId}@audit-commission-itest.local`,
        `Agent ${suffix}`,
      ],
    );

    const companyId = await scalar(
      tx,
      'INSERT INTO public.companies (name) VALUES ($1) RETURNING id',
      [`Audit commission ${suffix}`],
    );
    const cityId = await scalar(
      tx,
      'INSERT INTO public.cities (name_ar, name_fr) VALUES ($1, $2) RETURNING id',
      [`CityAr-${suffix}`, `City-${suffix}`],
    );
    const originId = await scalar(
      tx,
      `INSERT INTO public.stations (city_id, name_ar, name_fr) VALUES ($1, $2, $3) RETURNING id`,
      [cityId, `OriginAr-${suffix}`, `Origin-${suffix}`],
    );
    const destinationId = await scalar(
      tx,
      `INSERT INTO public.stations (city_id, name_ar, name_fr) VALUES ($1, $2, $3) RETURNING id`,
      [cityId, `DestinationAr-${suffix}`, `Destination-${suffix}`],
    );
    const layoutId = await scalar(
      tx,
      `INSERT INTO public.seat_layouts (name, total_seats, layout_grid)
       VALUES ($1, 1, '["S1"]'::jsonb) RETURNING id`,
      [`Audit commission layout ${suffix}`],
    );
    const busId = await scalar(
      tx,
      `INSERT INTO public.buses (company_id, seat_layout_id, plate_number)
       VALUES ($1, $2, $3) RETURNING id`,
      [companyId, layoutId, `AC-${suffix}`],
    );
    const routeId = await scalar(
      tx,
      `INSERT INTO public.routes (company_id, origin_station_id, destination_station_id,
         default_price_mru, estimated_duration_minutes)
       VALUES ($1, $2, $3, 80, 60) RETURNING id`,
      [companyId, originId, destinationId],
    );
    const tripId = await scalar(
      tx,
      `INSERT INTO public.trips (company_id, route_id, bus_id, departure_time,
         estimated_arrival_time, price_mru, boarding_closes_at)
       VALUES ($1, $2, $3, now() + interval '2 days', now() + interval '2 days 1 hour',
               80, now() + interval '1 day 23 hours')
       RETURNING id`,
      [companyId, routeId, busId],
    );
    await tx.query(
      `INSERT INTO public.company_memberships (user_id, company_id, role, commission_rate)
       VALUES ($1, $2, 'AGENT', 12.5)`,
      [agentUserId, companyId],
    );
    const bookingId = await scalar(
      tx,
      `INSERT INTO public.bookings (
         booking_reference, trip_id, company_id, booked_by_user_id, booking_channel, status,
         subtotal_amount, total_amount
       ) VALUES ($1, $2, $3, $4, 'AGENT', 'CONFIRMED', 80, 80)
       RETURNING id`,
      [`AC-${suffix}`, tripId, companyId, agentUserId],
    );

    return { companyId, agentUserId, bookingId };
  }

  it('creates a commission only for a confirmed booking owned by an active agent', async () => {
    if (!available) return;

    await inRollback(async (tx) => {
      const seed = await seedConfirmedAgentBooking(tx);
      const commissions = new PostgresCommissionsRepository();

      const eligible = await commissions.createEligible(
        tx,
        seed.bookingId,
        seed.companyId,
      );
      expect(eligible).toMatchObject({
        bookingId: seed.bookingId,
        companyId: seed.companyId,
        commissionRate: '12.50',
        baseAmount: '80.00',
        commissionAmount: '10.00',
        status: CommissionStatus.Earned,
      });
      expect(eligible?.earnedAt).toBeInstanceOf(Date);

      const nonAgentUserId = randomUUID();
      await tx.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [
        nonAgentUserId,
        `${nonAgentUserId}@audit-commission-itest.local`,
      ]);
      const ineligibleBookingId = await scalar(
        tx,
        `INSERT INTO public.bookings (
           booking_reference, trip_id, company_id, booked_by_user_id, booking_channel, status,
           subtotal_amount, total_amount
         ) SELECT $1, trip_id, company_id, $2, 'AGENT', 'CONFIRMED', 80, 80
             FROM public.bookings WHERE id = $3
         RETURNING id`,
        [
          `AC-non-agent-${nonAgentUserId.slice(0, 8)}`,
          nonAgentUserId,
          seed.bookingId,
        ],
      );
      await expect(
        commissions.createEligible(tx, ineligibleBookingId, seed.companyId),
      ).resolves.toBeNull();
    });
  });

  it('returns the original commission on retries without duplicating its database row', async () => {
    if (!available) return;

    await inRollback(async (tx) => {
      const seed = await seedConfirmedAgentBooking(tx);
      const commissions = new PostgresCommissionsRepository();
      const first = await commissions.createEligible(
        tx,
        seed.bookingId,
        seed.companyId,
      );
      const retry = await commissions.createEligible(
        tx,
        seed.bookingId,
        seed.companyId,
      );
      const count = await tx.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM public.agent_commission_transactions
         WHERE booking_id = $1 AND company_id = $2`,
        [seed.bookingId, seed.companyId],
      );

      expect(first?.id).toBeDefined();
      expect(retry?.id).toBe(first?.id);
      expect(count.rows[0]!.count).toBe('1');
    });
  });

  it('rejects direct changes to an earned commission financial snapshot', async () => {
    if (!available) return;

    await inRollback(async (tx) => {
      const seed = await seedConfirmedAgentBooking(tx);
      const commission =
        await new PostgresCommissionsRepository().createEligible(
          tx,
          seed.bookingId,
          seed.companyId,
        );

      await expect(
        tx.query(
          'UPDATE public.agent_commission_transactions SET commission_amount = 11 WHERE id = $1',
          [commission!.id],
        ),
      ).rejects.toMatchObject({
        driverError: {
          code: '55000',
          message: 'commission financial snapshot is immutable',
        },
      });
    });
  });

  it('stores valid audit context, nulls invalid context, and redacts metadata before persistence', async () => {
    if (!available) return;

    await inRollback(async (tx) => {
      const seed = await seedConfirmedAgentBooking(tx);
      const audit = new PostgresAuditRepository();
      const valid = await audit.append(tx, {
        actorUserId: seed.agentUserId,
        companyId: seed.companyId,
        action: 'commission.earned',
        entityType: 'agent_commission_transaction',
        entityId: seed.bookingId,
        requestId: UUID,
        correlationId: UUID,
        newValues: {
          status: 'EARNED',
          changes: {
            amount: 10,
            passengerPhone: '+22236000000',
            token: 'private',
          },
        },
      });
      const invalid = await audit.append(tx, {
        companyId: seed.companyId,
        action: 'commission.retry',
        entityType: 'agent_commission_transaction',
        entityId: seed.bookingId,
        requestId: 'browser-request-id',
        correlationId: 'trace-123',
      });
      const stored = await tx.query<{
        request_id: string | null;
        correlation_id: string | null;
        new_values: unknown;
      }>(
        'SELECT request_id::text, correlation_id::text, new_values FROM public.audit_logs WHERE id = $1',
        [valid.id],
      );

      expect(valid.requestId).toBe(UUID);
      expect(valid.correlationId).toBe(UUID);
      expect(valid.newValues).toEqual({
        status: 'EARNED',
        changes: { amount: 10 },
      });
      expect(stored.rows[0]).toEqual({
        request_id: UUID,
        correlation_id: UUID,
        new_values: { status: 'EARNED', changes: { amount: 10 } },
      });
      expect(invalid.requestId).toBeNull();
      expect(invalid.correlationId).toBeNull();
    });
  });

  it('enforces audit append-only records and denies direct authenticated writes', async () => {
    if (!available) return;

    await inRollback(async (tx) => {
      const seed = await seedConfirmedAgentBooking(tx);
      const entry = await new PostgresAuditRepository().append(tx, {
        companyId: seed.companyId,
        action: 'commission.earned',
        entityType: 'agent_commission_transaction',
        entityId: seed.bookingId,
      });

      await expect(
        tx.query('UPDATE public.audit_logs SET action = $1 WHERE id = $2', [
          'changed',
          entry.id,
        ]),
      ).rejects.toMatchObject({
        driverError: {
          code: '55000',
          message: 'audit_logs is append-only; UPDATE is forbidden',
        },
      });
    });

    await inRollback(async (tx) => {
      await tx.query('SET LOCAL role authenticated');
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: randomUUID(), role: 'authenticated' }),
      ]);

      await expect(
        tx.query(
          `INSERT INTO public.audit_logs (company_id, action, entity_type, entity_id)
           VALUES (1, 'direct.write', 'audit_log', '1')`,
        ),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
    });
  });
});
