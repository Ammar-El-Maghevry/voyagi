import type { PoolClient } from 'pg';

/**
 * Deterministic two-tenant fixture graph for the consolidated RLS matrix and the
 * SQL-injection integration suite. Everything is seeded on a single pinned
 * connection inside a transaction that the suite ROLLS BACK, so nothing is ever
 * committed to the database and suites never depend on execution order.
 *
 * The identifiers live in a reserved high range (96xxx / 96…-uuid) that does not
 * collide with application seed data. Relationships are explicit: every row
 * records which company / branch / owner it belongs to so tenant-A vs tenant-B
 * denial can be asserted precisely. No real personal information or secrets are
 * used — names are literal fixtures and the QR/secret columns hold hashes only.
 */

/** Stable fixture identifiers, grouped by kind for readable assertions. */
export const TENANT = {
  users: {
    managerA: '96000000-0000-4000-8000-000000000001',
    employeeA: '96000000-0000-4000-8000-000000000002',
    agentA: '96000000-0000-4000-8000-000000000003',
    agentAInactive: '96000000-0000-4000-8000-000000000004',
    passengerA: '96000000-0000-4000-8000-000000000005',
    managerB: '96000000-0000-4000-8000-000000000006',
    /** Authenticated user with no membership anywhere. */
    unrelated: '96000000-0000-4000-8000-000000000007',
  },
  companies: { a: 96001, b: 96002 },
  branches: { a1: 96001, a2: 96002, b1: 96003 },
  memberships: {
    managerA: 96001,
    employeeA: 96002,
    agentA: 96003,
    agentAInactive: 96004,
    managerB: 96005,
  },
  city: 96001,
  stations: { origin: 96001, destination: 96002 },
  seatLayout: 96001,
  staff: { a: 96001, b: 96002 },
  buses: { a: 96001, b: 96002 },
  routes: { a: 96001, b: 96002 },
  routePrice: 96001,
  trips: { a: 96001, b: 96002 },
  bookings: {
    /** Agent-made booking on branch A1 (owner = agentA). */
    aAgent: '96000000-0000-4000-9000-000000000001',
    /** Web booking with no branch (owner = passengerA). */
    aWeb: '96000000-0000-4000-9000-000000000002',
    /** Tenant-B booking (owner = managerB). */
    b: '96000000-0000-4000-9000-000000000003',
  },
  payments: {
    aAgent: '96000000-0000-4000-a000-000000000001',
    b: '96000000-0000-4000-a000-000000000002',
  },
  tickets: { aAgent: '96000000-0000-4000-b000-000000000001' },
  commission: '96000000-0000-4000-c000-000000000001',
} as const;

/** Identity ids that PostgreSQL assigns (identity columns), captured on seed. */
export interface SeededIdentityIds {
  passengerAId: string;
  passengerBId: string;
  seatReservationAId: string;
  seatReservationBId: string;
  tripEventId: string;
  bookingEventId: string;
  maintenanceId: string;
  auditLogId: string;
  routePriceId: string;
}

/** The full handle returned by {@link seedTenantGraph}. */
export interface TenantGraph {
  ids: typeof TENANT;
  identity: SeededIdentityIds;
}

async function insertReturningId(
  client: PoolClient,
  sql: string,
  params: unknown[],
): Promise<string> {
  const result = await client.query<{ id: string }>(sql, params);
  return String(result.rows[0].id);
}

/**
 * Seed the deterministic tenant graph on the given client. The caller owns the
 * surrounding transaction (and must ROLL IT BACK). Runs as the connecting role,
 * which bypasses RLS — that is intentional: RLS is then asserted by switching to
 * the non-bypassing `authenticated`/`anon` roles in the same transaction.
 */
export async function seedTenantGraph(
  client: PoolClient,
): Promise<TenantGraph> {
  const u = TENANT.users;

  // Auth users (a trigger auto-creates the matching public.profiles row).
  await client.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
     values
       ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', 'rls-manager-a@voyagi.test', '', now(), now(), now(), '{}', '{"full_name":"RLS Manager A"}'),
       ('00000000-0000-0000-0000-000000000000', $2, 'authenticated', 'authenticated', 'rls-employee-a@voyagi.test', '', now(), now(), now(), '{}', '{"full_name":"RLS Employee A"}'),
       ('00000000-0000-0000-0000-000000000000', $3, 'authenticated', 'authenticated', 'rls-agent-a@voyagi.test', '', now(), now(), now(), '{}', '{"full_name":"RLS Agent A"}'),
       ('00000000-0000-0000-0000-000000000000', $4, 'authenticated', 'authenticated', 'rls-agent-a-inactive@voyagi.test', '', now(), now(), now(), '{}', '{"full_name":"RLS Agent A Inactive"}'),
       ('00000000-0000-0000-0000-000000000000', $5, 'authenticated', 'authenticated', 'rls-passenger-a@voyagi.test', '', now(), now(), now(), '{}', '{"full_name":"RLS Passenger A"}'),
       ('00000000-0000-0000-0000-000000000000', $6, 'authenticated', 'authenticated', 'rls-manager-b@voyagi.test', '', now(), now(), now(), '{}', '{"full_name":"RLS Manager B"}'),
       ('00000000-0000-0000-0000-000000000000', $7, 'authenticated', 'authenticated', 'rls-unrelated@voyagi.test', '', now(), now(), now(), '{}', '{"full_name":"RLS Unrelated"}')`,
    [
      u.managerA,
      u.employeeA,
      u.agentA,
      u.agentAInactive,
      u.passengerA,
      u.managerB,
      u.unrelated,
    ],
  );

  await client.query(
    `insert into public.cities (id, name_ar, name_fr) overriding system value
     values ($1, 'مدينة RLS', 'RLS City')`,
    [TENANT.city],
  );
  await client.query(
    `insert into public.stations (id, city_id, name_ar, name_fr) overriding system value
     values ($1, $3, 'محطة الأصل', 'Origin'), ($2, $3, 'محطة الوجهة', 'Destination')`,
    [TENANT.stations.origin, TENANT.stations.destination, TENANT.city],
  );

  await client.query(
    `insert into public.companies (id, name) overriding system value
     values ($1, 'RLS Company A'), ($2, 'RLS Company B')`,
    [TENANT.companies.a, TENANT.companies.b],
  );
  await client.query(
    `insert into public.branches (id, company_id, city_id, name_ar, name_fr) overriding system value
     values ($1, $4, $6, 'فرع أ1', 'Branch A1'),
            ($2, $4, $6, 'فرع أ2', 'Branch A2'),
            ($3, $5, $6, 'فرع ب1', 'Branch B1')`,
    [
      TENANT.branches.a1,
      TENANT.branches.a2,
      TENANT.branches.b1,
      TENANT.companies.a,
      TENANT.companies.b,
      TENANT.city,
    ],
  );

  await client.query(
    `insert into public.company_memberships (id, user_id, company_id, branch_id, role, commission_rate, is_active) overriding system value
     values
       ($1, $6, $11, null, 'COMPANY_MANAGER', 0, true),
       ($2, $7, $11, $12, 'BRANCH_EMPLOYEE', 0, true),
       ($3, $8, $11, $12, 'AGENT', 10, true),
       ($4, $9, $11, $12, 'AGENT', 10, false),
       ($5, $10, $13, null, 'COMPANY_MANAGER', 0, true)`,
    [
      TENANT.memberships.managerA,
      TENANT.memberships.employeeA,
      TENANT.memberships.agentA,
      TENANT.memberships.agentAInactive,
      TENANT.memberships.managerB,
      u.managerA,
      u.employeeA,
      u.agentA,
      u.agentAInactive,
      u.managerB,
      TENANT.companies.a,
      TENANT.branches.a1,
      TENANT.companies.b,
    ],
  );

  await client.query(
    `insert into public.seat_layouts (id, name, total_seats, layout_grid) overriding system value
     values ($1, 'RLS Layout', 2, '["1", "2"]')`,
    [TENANT.seatLayout],
  );
  await client.query(
    `insert into public.buses (id, company_id, seat_layout_id, plate_number) overriding system value
     values ($1, $3, $5, 'RLS-A'), ($2, $4, $5, 'RLS-B')`,
    [
      TENANT.buses.a,
      TENANT.buses.b,
      TENANT.companies.a,
      TENANT.companies.b,
      TENANT.seatLayout,
    ],
  );
  await client.query(
    `insert into public.staff_members (id, company_id, full_name, staff_type) overriding system value
     values ($1, $3, 'RLS Driver A', 'DRIVER'), ($2, $4, 'RLS Driver B', 'DRIVER')`,
    [96001, 96002, TENANT.companies.a, TENANT.companies.b],
  );
  await client.query(
    `insert into public.routes (id, company_id, origin_station_id, destination_station_id,
       default_price_mru, estimated_duration_minutes) overriding system value
     values ($1, $3, $5, $6, 100, 60), ($2, $4, $5, $6, 100, 60)`,
    [
      TENANT.routes.a,
      TENANT.routes.b,
      TENANT.companies.a,
      TENANT.companies.b,
      TENANT.stations.origin,
      TENANT.stations.destination,
    ],
  );
  const routePriceId = await insertReturningId(
    client,
    `insert into public.route_price_history (id, route_id, price_mru, changed_by_user_id, change_reason)
       overriding system value
     values ($1, $2, 100, $3, 'seed') returning id`,
    [TENANT.routePrice, TENANT.routes.a, u.managerA],
  );

  await client.query(
    `insert into public.trips (id, company_id, route_id, bus_id, departure_time,
       estimated_arrival_time, price_mru, boarding_closes_at) overriding system value
     values
       ($1, $3, $5, $7, now() + interval '1 day', now() + interval '1 day 1 hour', 100, now() + interval '23 hours'),
       ($2, $4, $6, $8, now() + interval '1 day', now() + interval '1 day 1 hour', 100, now() + interval '23 hours')`,
    [
      TENANT.trips.a,
      TENANT.trips.b,
      TENANT.companies.a,
      TENANT.companies.b,
      TENANT.routes.a,
      TENANT.routes.b,
      TENANT.buses.a,
      TENANT.buses.b,
    ],
  );
  const tripEventId = await insertReturningId(
    client,
    `insert into public.trip_events (trip_id, company_id, actor_user_id, event_type, event_source)
     values ($1, $2, $3, 'TRIP_CREATED', 'SYSTEM') returning id`,
    [TENANT.trips.a, TENANT.companies.a, u.managerA],
  );

  // Bookings: one agent (branch A1), one web (branch null, owner passengerA), one tenant B.
  await client.query(
    `insert into public.bookings (id, booking_reference, trip_id, company_id, branch_id,
       booked_by_user_id, booking_channel, status, subtotal_amount, total_amount, idempotency_key)
     values
       ($1, 'RLS-A-AGENT', $6, $8, $10, $4, 'AGENT', 'CONFIRMED', 100, 100, 'rls-idem-a-agent'),
       ($2, 'RLS-A-WEB', $6, $8, null, $5, 'WEB', 'CONFIRMED', 100, 100, 'rls-idem-a-web'),
       ($3, 'RLS-B', $7, $9, $11, $12, 'BRANCH_OFFICE', 'CONFIRMED', 100, 100, 'rls-idem-b')`,
    [
      TENANT.bookings.aAgent,
      TENANT.bookings.aWeb,
      TENANT.bookings.b,
      u.agentA,
      u.passengerA,
      TENANT.trips.a,
      TENANT.trips.b,
      TENANT.companies.a,
      TENANT.companies.b,
      TENANT.branches.a1,
      TENANT.branches.b1,
      u.managerB,
    ],
  );
  const bookingEventId = await insertReturningId(
    client,
    `insert into public.booking_events (booking_id, company_id, actor_user_id, event_type)
     values ($1, $2, $3, 'BOOKING_CREATED') returning id`,
    [TENANT.bookings.aAgent, TENANT.companies.a, u.agentA],
  );

  const passengerAId = await insertReturningId(
    client,
    `insert into public.passengers (booking_id, full_name, phone, document_number, boarding_station_id)
     values ($1, 'RLS Passenger One', '+22200000001', 'RLS-DOC-A', $2) returning id`,
    [TENANT.bookings.aAgent, TENANT.stations.origin],
  );
  const passengerBId = await insertReturningId(
    client,
    `insert into public.passengers (booking_id, full_name, phone, document_number, boarding_station_id)
     values ($1, 'RLS Passenger Two', '+22200000002', 'RLS-DOC-B', $2) returning id`,
    [TENANT.bookings.b, TENANT.stations.origin],
  );

  const seatReservationAId = await insertReturningId(
    client,
    `insert into public.seat_reservations (trip_id, booking_id, passenger_id, seat_number, status)
     values ($1, $2, $3, '1', 'CONFIRMED') returning id`,
    [TENANT.trips.a, TENANT.bookings.aAgent, passengerAId],
  );
  const seatReservationBId = await insertReturningId(
    client,
    `insert into public.seat_reservations (trip_id, booking_id, passenger_id, seat_number, status)
     values ($1, $2, $3, '1', 'CONFIRMED') returning id`,
    [TENANT.trips.b, TENANT.bookings.b, passengerBId],
  );

  await client.query(
    `insert into public.payments (id, booking_id, method, status, amount, internal_reference, provider_reference, paid_at)
     values
       ($1, $3, 'BANKILY', 'SUCCEEDED', 100, 'RLS-PAY-A', 'RLS-PROV-A', now()),
       ($2, $4, 'BANKILY', 'SUCCEEDED', 100, 'RLS-PAY-B', 'RLS-PROV-B', now())`,
    [
      TENANT.payments.aAgent,
      TENANT.payments.b,
      TENANT.bookings.aAgent,
      TENANT.bookings.b,
    ],
  );

  await client.query(
    `insert into public.tickets (id, booking_id, passenger_id, seat_reservation_id,
       ticket_number, qr_token_hash)
     values ($1, $2, $3, $4, 'RLS-TICKET-A', 'rls-qr-hash-a-0000000000000000')`,
    [
      TENANT.tickets.aAgent,
      TENANT.bookings.aAgent,
      passengerAId,
      seatReservationAId,
    ],
  );

  await client.query(
    `insert into public.agent_commission_transactions (id, agent_membership_id, booking_id,
       company_id, commission_rate, base_amount, commission_amount, status, earned_at)
     values ($1, $2, $3, $4, 10, 100, 10, 'EARNED', now())`,
    [
      TENANT.commission,
      TENANT.memberships.agentA,
      TENANT.bookings.aAgent,
      TENANT.companies.a,
    ],
  );

  const maintenanceId = await insertReturningId(
    client,
    `insert into public.vehicle_maintenance_records (bus_id, company_id, maintenance_type,
       status, started_at, scheduled_ends_at, created_by_user_id)
     values ($1, $2, 'OIL_CHANGE', 'SCHEDULED', now(), now() + interval '2 hours', $3) returning id`,
    [TENANT.buses.a, TENANT.companies.a, u.managerA],
  );

  const auditLogId = await insertReturningId(
    client,
    `insert into public.audit_logs (actor_user_id, company_id, action, entity_type, entity_id)
     values ($1, $2, 'SEED', 'booking', $3) returning id`,
    [u.managerA, TENANT.companies.a, TENANT.bookings.aAgent],
  );

  return {
    ids: TENANT,
    identity: {
      passengerAId,
      passengerBId,
      seatReservationAId,
      seatReservationBId,
      tripEventId,
      bookingEventId,
      maintenanceId,
      auditLogId,
      routePriceId,
    },
  };
}
