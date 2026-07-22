begin;

create extension if not exists pgtap with schema extensions;
select plan(75);

select is(
  (select count(*)
   from information_schema.columns
   where table_schema = 'public'
     and column_default like 'nextval(%'
     and is_identity = 'NO'),
  0::bigint,
  'no public table uses SERIAL-backed columns'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'manager-a@voyagi.test', '', now(), now(), now(), '{}', '{"full_name":"Manager A"}'),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'branch-a@voyagi.test', '', now(), now(), now(), '{}', '{"full_name":"Branch A"}'),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'agent-a@voyagi.test', '', now(), now(), now(), '{}', '{"full_name":"Agent A"}'),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000004',
   'authenticated', 'authenticated', 'manager-b@voyagi.test', '', now(), now(), now(), '{}', '{"full_name":"Manager B"}');

select lives_ok(
  $$update public.profiles set phone_number = '+12345678901234567890'
    where id = '10000000-0000-0000-0000-000000000001'$$,
  'international phone numbers are accepted'
);
select throws_ok(
  $$update public.profiles set phone_number = 'not-a-phone'
    where id = '10000000-0000-0000-0000-000000000001'$$,
  '23514', 'new row for relation "profiles" violates check constraint "ck_profiles_phone"',
  'invalid phone numbers are rejected'
);

insert into public.cities (id, name_ar, name_fr) overriding system value
values (90001, 'مدينة اختبار', 'Test City');

insert into public.stations (id, city_id, name_ar, name_fr) overriding system value
values
  (90001, 90001, 'المحطة أ', 'Station A'),
  (90002, 90001, 'المحطة ب', 'Station B');

insert into public.companies (id, name) overriding system value
values (90001, 'Test Company A'), (90002, 'Test Company B');

insert into public.branches (id, company_id, city_id, name_ar, name_fr) overriding system value
values
  (90001, 90001, 90001, 'فرع أ', 'Branch A'),
  (90002, 90001, 90001, 'فرع ب', 'Branch B'),
  (90003, 90002, 90001, 'فرع ج', 'Branch C');

insert into public.company_memberships (
  id, user_id, company_id, branch_id, role, commission_rate
) overriding system value
values
  (90001, '10000000-0000-0000-0000-000000000001', 90001, null, 'COMPANY_MANAGER', 0),
  (90002, '10000000-0000-0000-0000-000000000002', 90001, 90001, 'BRANCH_EMPLOYEE', 0),
  (90003, '10000000-0000-0000-0000-000000000003', 90001, 90001, 'AGENT', 10),
  (90004, '10000000-0000-0000-0000-000000000004', 90002, null, 'COMPANY_MANAGER', 0);

insert into public.seat_layouts (id, name, total_seats, layout_grid) overriding system value
values (90001, 'Test Layout', 2, '["1", "2"]');

insert into public.buses (id, company_id, seat_layout_id, plate_number) overriding system value
values
  (90001, 90001, 90001, 'TEST-A'),
  (90002, 90002, 90001, 'TEST-B');

insert into public.routes (
  id, company_id, origin_station_id, destination_station_id,
  default_price_mru, estimated_duration_minutes
) overriding system value
values
  (90001, 90001, 90001, 90002, 100, 60),
  (90002, 90002, 90001, 90002, 100, 60);

insert into public.trips (
  id, company_id, route_id, bus_id, departure_time,
  estimated_arrival_time, price_mru, boarding_closes_at
) overriding system value
values
  (90001, 90001, 90001, 90001, now() + interval '1 day', now() + interval '1 day 1 hour', 100, now() + interval '23 hours'),
  (90002, 90002, 90002, 90002, now() + interval '1 day', now() + interval '1 day 1 hour', 100, now() + interval '23 hours');

insert into public.bookings (
  id, booking_reference, trip_id, company_id, branch_id, booked_by_user_id,
  booking_channel, status, subtotal_amount, total_amount, idempotency_key
)
values
  ('20000000-0000-0000-0000-000000000001', 'TEST-A-1', 90001, 90001, 90001,
   '10000000-0000-0000-0000-000000000003', 'AGENT', 'CONFIRMED', 100, 100, 'idem-a-1'),
  ('20000000-0000-0000-0000-000000000002', 'TEST-A-2', 90001, 90001, 90002,
   '10000000-0000-0000-0000-000000000001', 'BRANCH_OFFICE', 'CONFIRMED', 100, 100, 'idem-a-2'),
  ('20000000-0000-0000-0000-000000000003', 'TEST-B-1', 90002, 90002, 90003,
   '10000000-0000-0000-0000-000000000004', 'BRANCH_OFFICE', 'CONFIRMED', 100, 100, 'idem-b-1'),
  ('20000000-0000-0000-0000-000000000004', 'TEST-A-WEB', 90001, 90001, null,
   '10000000-0000-0000-0000-000000000001', 'WEB', 'CONFIRMED', 100, 100, 'idem-a-web');

select is(
  (select booking_source from public.bookings
   where id = '20000000-0000-0000-0000-000000000001'),
  'AGENT'::public.booking_source_enum,
  'legacy inserts derive analytics source from booking channel'
);
select is(
  (select ticket_price_snapshot from public.bookings
   where id = '20000000-0000-0000-0000-000000000001'),
  100.00::numeric,
  'bookings snapshot the trip ticket price when omitted'
);
select is(
  (select count(*)
   from information_schema.columns
   where table_schema = 'public'
     and table_name in (
       'bookings', 'payments', 'routes', 'route_price_history', 'trips',
       'agent_commission_transactions', 'vehicle_maintenance_records'
     )
     and column_name = 'currency'
     and data_type = 'character'
     and character_maximum_length = 3
     and is_nullable = 'NO'),
  7::bigint,
  'every monetary table has a required three-letter currency'
);
select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'tickets' and column_name = 'qr_token'),
  0::bigint,
  'tickets never store raw QR tokens'
);
select is((select distance_km from public.routes where id = 90001), 0.00::numeric,
  'routes default distance to zero');
select is((select current_odometer_km from public.buses where id = 90001), 0,
  'buses default their odometer to zero');
select is((select version from public.buses where id = 90001), 1,
  'buses start at optimistic-lock version one');
select is((select version from public.trips where id = 90001), 1,
  'trips start at optimistic-lock version one');
select is(
  (select version from public.bookings
   where id = '20000000-0000-0000-0000-000000000001'),
  1,
  'bookings start at optimistic-lock version one'
);
select throws_ok(
  $$update public.routes set distance_km = -1 where id = 90001$$,
  '23514', 'new row for relation "routes" violates check constraint "ck_routes_distance"',
  'route distance cannot be negative'
);
select throws_ok(
  $$update public.buses set version = 0 where id = 90001$$,
  '23514', 'new row for relation "buses" violates check constraint "ck_buses_version"',
  'optimistic-lock versions must remain positive'
);
select throws_ok(
  $$update public.trips set actual_arrival_time = now() where id = 90001$$,
  '23514', 'new row for relation "trips" violates check constraint "ck_trips_actual_times"',
  'actual arrival requires a valid actual departure'
);

insert into public.passengers (id, booking_id, full_name) overriding system value
values
  (90001, '20000000-0000-0000-0000-000000000002', 'Passenger One'),
  (90002, '20000000-0000-0000-0000-000000000002', 'Passenger Two');

insert into public.seat_reservations (trip_id, booking_id, seat_number, status)
values (90001, '20000000-0000-0000-0000-000000000001', '1', 'CONFIRMED');

select throws_ok(
  $$insert into public.seat_reservations (trip_id, booking_id, seat_number, status)
    values (90001, '20000000-0000-0000-0000-000000000002', '1', 'CONFIRMED')$$,
  '23505', 'duplicate key value violates unique constraint "uq_active_seat_per_trip"',
  'an active seat cannot be double booked'
);

update public.seat_reservations set status = 'CANCELLED'
where trip_id = 90001 and seat_number = '1';
select lives_ok(
  $$insert into public.seat_reservations (trip_id, booking_id, seat_number, status)
    values (90001, '20000000-0000-0000-0000-000000000002', '1', 'CONFIRMED')$$,
  'a released or cancelled seat can be booked again'
);

update public.seat_reservations set passenger_id = 90002
where booking_id = '20000000-0000-0000-0000-000000000002' and seat_number = '1';

select throws_ok(
  $$insert into public.seat_reservations (trip_id, booking_id, seat_number, status)
    values (90001, '20000000-0000-0000-0000-000000000001', '2 ', 'CONFIRMED')$$,
  '23514', 'seat_number is not present in the trip bus layout',
  'seat labels cannot use whitespace aliases'
);

select throws_ok(
  $$insert into public.seat_reservations (trip_id, booking_id, seat_number, status)
    values (90001, '20000000-0000-0000-0000-000000000001', '999', 'CONFIRMED')$$,
  '23514', 'seat_number is not present in the trip bus layout',
  'seat labels must exist in the assigned bus layout'
);

select throws_ok(
  $$insert into public.bookings (
      booking_reference, trip_id, company_id, booking_channel, status,
      subtotal_amount, total_amount
    ) values ('TEST-CROSS-COMPANY', 90001, 90002, 'ADMIN', 'DRAFT', 100, 100)$$,
  '23503', 'insert or update on table "bookings" violates foreign key constraint "fk_bookings_trip_company"',
  'a booking cannot point to another company trip'
);

insert into public.idempotency_records (
  company_id, actor_user_id, operation, idempotency_key, request_fingerprint
) values (
  90001, '10000000-0000-0000-0000-000000000001',
  'CREATE_PASSENGER_BOOKING', 'idem-a-1', repeat('a', 64)
);
select throws_ok(
  $$insert into public.idempotency_records (
      company_id, actor_user_id, operation, idempotency_key, request_fingerprint
    ) values (
      90001, '10000000-0000-0000-0000-000000000001',
      'CREATE_PASSENGER_BOOKING', 'idem-a-1', repeat('b', 64)
    )$$,
  '23505', 'duplicate key value violates unique constraint "uq_idempotency_scope"',
  'idempotency keys are unique within caller, company, and operation scope'
);

insert into public.payments (
  booking_id, method, status, amount, provider_reference, internal_reference, paid_at
)
values (
  '20000000-0000-0000-0000-000000000001', 'BANKILY', 'SUCCEEDED', 100,
  'provider-test-1', 'internal-test-1', now()
);
select throws_ok(
  $$insert into public.payments (
      booking_id, method, status, amount, provider_reference, internal_reference, paid_at
    ) values (
      '20000000-0000-0000-0000-000000000002', 'BANKILY', 'SUCCEEDED', 100,
      'provider-test-1', 'internal-test-2', now()
    )$$,
  '23505', 'duplicate key value violates unique constraint "uq_payment_provider_ref"',
  'provider payment references are unique per method'
);
select lives_ok(
  $$insert into public.payments (
      booking_id, method, status, amount, provider_reference, internal_reference, paid_at
    ) values (
      '20000000-0000-0000-0000-000000000002', 'MASRVI', 'SUCCEEDED', 100,
      'provider-test-1', 'internal-test-3', now()
    )$$,
  'different providers may use the same external reference'
);

select throws_ok(
  $$insert into public.payments (
      booking_id, method, status, amount, provider_reference, internal_reference, paid_at
    ) values (
      '20000000-0000-0000-0000-000000000001', 'MASRVI', 'SUCCEEDED', 100,
      'provider-test-2', 'internal-test-4', now()
    )$$,
  '23505', 'duplicate key value violates unique constraint "uq_successful_payment_per_booking"',
  'a booking cannot have two successful payments'
);

select throws_ok(
  $$insert into public.payments (
      booking_id, method, status, amount, provider_reference, internal_reference
    ) values (
      '20000000-0000-0000-0000-000000000003', 'BANKILY', 'REFUNDED', 100,
      'provider-refund-without-payment', 'internal-refund-without-payment'
    )$$,
  '23514', 'new row for relation "payments" violates check constraint "ck_payments_success_paid_at"',
  'refund states retain evidence of the original successful payment'
);

insert into public.agent_commission_transactions (
  agent_membership_id, booking_id, company_id, commission_rate,
  base_amount, commission_amount, status, earned_at
)
values (
  90003, '20000000-0000-0000-0000-000000000001', 90001,
  10, 100, 10, 'EARNED', now()
);
select throws_ok(
  $$insert into public.agent_commission_transactions (
      agent_membership_id, booking_id, company_id, commission_rate,
      base_amount, commission_amount, status, earned_at
    ) values (
      90003, '20000000-0000-0000-0000-000000000001', 90001,
      10, 100, 10, 'EARNED', now()
    )$$,
  '23505', 'duplicate key value violates unique constraint "uq_commission_per_agent_booking"',
  'an agent receives at most one commission per booking'
);

select throws_ok(
  $$insert into public.agent_commission_transactions (
      agent_membership_id, booking_id, company_id, commission_rate,
      base_amount, commission_amount, status, earned_at
    ) values (
      90001, '20000000-0000-0000-0000-000000000002', 90001,
      10, 100, 10, 'EARNED', now()
    )$$,
  '23514', 'commission requires the active agent who confirmed the booking',
  'commission eligibility requires the booking agent membership'
);

select throws_ok(
  $$insert into public.tickets (
      booking_id, passenger_id, seat_reservation_id, ticket_number, qr_token_hash
    )
    select '20000000-0000-0000-0000-000000000002', 90001, seat.id, 'TEST-TICKET', 'test-hash'
    from public.seat_reservations seat
    where seat.booking_id = '20000000-0000-0000-0000-000000000002' and seat.seat_number = '1'$$,
  '23503', 'insert or update on table "tickets" violates foreign key constraint "fk_ticket_seat_passenger"',
  'a ticket passenger must own its referenced seat'
);

insert into public.route_price_history (
  route_id, price_mru, effective_from, effective_to
)
values (90001, 100, '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00');
select throws_ok(
  $$insert into public.route_price_history (
      route_id, price_mru, effective_from, effective_to
    ) values (90001, 110, '2026-01-15 00:00:00+00', '2026-03-01 00:00:00+00')$$,
  '23P01', 'conflicting key value violates exclusion constraint "ex_route_price_periods"',
  'route price history periods cannot overlap'
);

select throws_ok(
  $$insert into public.vehicle_maintenance_records (
      bus_id, company_id, maintenance_type, status, started_at, scheduled_ends_at
    ) values (90001, 90002, 'INSPECTION', 'SCHEDULED', now(), now() + interval '1 hour')$$,
  '23503', 'insert or update on table "vehicle_maintenance_records" violates foreign key constraint "fk_maintenance_bus_company"',
  'maintenance cannot point to another company bus'
);

select throws_ok(
  $$insert into public.vehicle_maintenance_records (
      bus_id, company_id, maintenance_type, status, started_at
    ) values (90001, 90001, 'INSPECTION', 'SCHEDULED', now())$$,
  '23514', 'new row for relation "vehicle_maintenance_records" violates check constraint "ck_maintenance_scheduled_requires_end"',
  'scheduled maintenance requires a planned end'
);
select lives_ok(
  $$insert into public.vehicle_maintenance_records (
      bus_id, company_id, maintenance_type, status, started_at, scheduled_ends_at
    ) values (90001, 90001, 'INSPECTION', 'SCHEDULED', now(), now() + interval '2 hours')$$,
  'scheduled maintenance with a finite half-open window is allowed'
);
select throws_ok(
  $$insert into public.vehicle_maintenance_records (
      bus_id, company_id, maintenance_type, status, started_at, scheduled_ends_at
    ) values (90001, 90001, 'ENGINE', 'SCHEDULED', now(), now() + interval '3 hours')$$,
  '23505', 'duplicate key value violates unique constraint "uq_maintenance_one_active_record_per_bus"',
  'only one scheduled or in-progress maintenance record may exist per bus'
);
select lives_ok(
  $$update public.vehicle_maintenance_records set status = 'IN_PROGRESS'
      where bus_id = 90001 and company_id = 90001$$,
  'SCHEDULED maintenance can begin'
);
select lives_ok(
  $$update public.vehicle_maintenance_records set status = 'COMPLETED', completed_at = now()
      where bus_id = 90001 and company_id = 90001$$,
  'IN_PROGRESS maintenance can complete with a server-controlled completion timestamp'
);
select throws_ok(
  $$update public.vehicle_maintenance_records set status = 'SCHEDULED'
      where bus_id = 90001 and company_id = 90001$$,
  '23514', 'illegal maintenance transition COMPLETED -> SCHEDULED',
  'completed maintenance cannot be reopened'
);
select throws_ok(
  $$update public.agent_commission_transactions set commission_amount = 11
      where agent_membership_id = 90003 and booking_id = '20000000-0000-0000-0000-000000000001'$$,
  '55000', 'commission financial snapshot is immutable',
  'commission calculation snapshots cannot be changed'
);
select lives_ok(
  $$update public.agent_commission_transactions set status = 'CANCELLED', cancelled_at = now()
      where agent_membership_id = 90003 and booking_id = '20000000-0000-0000-0000-000000000001'$$,
  'EARNED commission can be cancelled through its lifecycle transition'
);
select throws_ok(
  $$update public.agent_commission_transactions set status = 'EARNED'
      where agent_membership_id = 90003 and booking_id = '20000000-0000-0000-0000-000000000001'$$,
  '23514', 'illegal commission transition CANCELLED -> EARNED',
  'cancelled commission is terminal'
);
insert into public.audit_logs (company_id, action, entity_type, entity_id)
values (90001, 'PGTAP_AUDIT_APPEND', 'audit_log', 'pgtap');
select throws_ok(
  $$delete from public.audit_logs where action = 'PGTAP_AUDIT_APPEND'$$,
  '55000', 'audit_logs is append-only; DELETE is forbidden',
  'audit logs remain append-only'
);

insert into public.trip_events (trip_id, company_id, event_type, event_source)
values (90001, 90001, 'TRIP_CREATED', 'SYSTEM');
select throws_ok(
  $$update public.trip_events set event_type = 'DELAYED' where trip_id = 90001$$,
  '55000', 'trip_events is append-only; UPDATE is forbidden',
  'trip events cannot be updated'
);

select lives_ok(
  $$insert into public.booking_events (
      booking_id, company_id, actor_user_id, event_type, metadata
    ) values (
      '20000000-0000-0000-0000-000000000001', 90001,
      '10000000-0000-0000-0000-000000000003', 'BOOKING_CREATED', '{"source":"test"}'
    )$$,
  'booking events can be appended'
);
insert into public.booking_events (booking_id, company_id, event_type)
values
  ('20000000-0000-0000-0000-000000000002', 90001, 'BOOKING_CREATED'),
  ('20000000-0000-0000-0000-000000000003', 90002, 'BOOKING_CREATED');
select throws_ok(
  $$insert into public.booking_events (booking_id, company_id, event_type)
    values ('20000000-0000-0000-0000-000000000001', 90002, 'CANCELLED')$$,
  '23503', 'insert or update on table "booking_events" violates foreign key constraint "fk_booking_events_booking_company"',
  'booking events cannot cross company boundaries'
);
select throws_ok(
  $$update public.booking_events set event_type = 'CANCELLED'
    where booking_id = '20000000-0000-0000-0000-000000000001'$$,
  '55000', 'booking_events is append-only; UPDATE is forbidden',
  'booking events cannot be updated'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001';
select is((select count(*) from public.bookings where company_id = 90002), 0::bigint,
  'company RLS hides another company bookings');
select is((select count(*) from public.bookings where company_id = 90001), 3::bigint,
  'company manager can read own company bookings');
select is((select count(*) from public.booking_events where company_id = 90002), 0::bigint,
  'booking event RLS hides another company events');
select is((select count(*) from public.booking_events where company_id = 90001), 2::bigint,
  'company manager can read own company booking events');
select is((select count(*) from public.vehicle_maintenance_records where company_id = 90001), 1::bigint,
  'company manager can read own company maintenance records');
select is((select count(*) from public.agent_commission_transactions where company_id = 90001), 1::bigint,
  'company manager can read own company commissions');
select is((select count(*) from public.audit_logs where company_id = 90001), 1::bigint,
  'company manager can read own company audit logs');
select is((select count(*) from public.vehicle_maintenance_records where company_id = 90002), 0::bigint,
  'company manager cannot read another company maintenance records');
select is((select count(*) from public.agent_commission_transactions where company_id = 90002), 0::bigint,
  'company manager cannot read another company commissions');
select is((select count(*) from public.audit_logs where company_id = 90002), 0::bigint,
  'company manager cannot read another company audit logs');

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000002';
select is((select count(*) from public.bookings where branch_id = 90002), 0::bigint,
  'branch RLS hides another branch bookings');
select is((select count(*) from public.bookings where branch_id = 90001), 1::bigint,
  'branch employee can read own branch bookings');
select is((select count(*) from public.bookings where branch_id is null), 0::bigint,
  'branch employee cannot read unassigned online bookings');
select is(
  (select count(*) from public.booking_events
   where booking_id = '20000000-0000-0000-0000-000000000001'),
  1::bigint,
  'branch employee can read own branch booking events'
);
select is(
  (select count(*) from public.booking_events
   where booking_id = '20000000-0000-0000-0000-000000000002'),
  0::bigint,
  'branch employee cannot read another branch booking events'
);
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000003';
select is((select count(*) from public.agent_commission_transactions where company_id = 90001), 1::bigint,
  'owning active agent can read own commission rows');
reset role;
update public.company_memberships set is_active = false where id = 90003;
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000003';
select is((select count(*) from public.agent_commission_transactions where company_id = 90001), 0::bigint,
  'inactive agent membership cannot read commission rows');
reset role;
update public.company_memberships set is_active = true where id = 90003;
set local role authenticated;
select is(
  has_table_privilege('authenticated', 'public.vehicle_maintenance_records', 'INSERT')
    or has_table_privilege('authenticated', 'public.vehicle_maintenance_records', 'UPDATE')
    or has_table_privilege('authenticated', 'public.vehicle_maintenance_records', 'DELETE'),
  false,
  'authenticated has no direct maintenance writes'
);
select is(
  has_table_privilege('authenticated', 'public.agent_commission_transactions', 'INSERT')
    or has_table_privilege('authenticated', 'public.agent_commission_transactions', 'UPDATE')
    or has_table_privilege('authenticated', 'public.agent_commission_transactions', 'DELETE'),
  false,
  'authenticated has no direct commission writes'
);
select is(
  has_table_privilege('authenticated', 'public.audit_logs', 'INSERT')
    or has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE')
    or has_table_privilege('authenticated', 'public.audit_logs', 'DELETE'),
  false,
  'authenticated has no direct audit writes'
);
select is(
  (select count(*)
   from pg_catalog.pg_class class
   join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
   where namespace.nspname = 'public' and class.relkind = 'r' and not class.relrowsecurity),
  0::bigint,
  'RLS is enabled on every public application table'
);
select throws_ok(
  $$insert into public.bookings (
      booking_reference, trip_id, company_id, booking_channel, status,
      subtotal_amount, total_amount
    ) values ('CLIENT-WRITE', 90001, 90001, 'WEB', 'DRAFT', 100, 100)$$,
  '42501', 'permission denied for table bookings',
  'authenticated clients cannot write bookings directly'
);
select throws_ok(
  $$insert into public.audit_logs (company_id, action, entity_type, entity_id)
    values (90001, 'CLIENT_WRITE', 'audit_log', '1')$$,
  '42501', 'permission denied for table audit_logs',
  'authenticated clients cannot insert audit rows directly'
);
select throws_ok(
  $$insert into public.vehicle_maintenance_records (
      bus_id, company_id, maintenance_type, status, started_at, scheduled_ends_at
    ) values (90001, 90001, 'OTHER', 'SCHEDULED', now(), now() + interval '1 hour')$$,
  '42501', 'permission denied for table vehicle_maintenance_records',
  'authenticated clients cannot insert maintenance records directly'
);
select throws_ok(
  $$insert into public.agent_commission_transactions (
      agent_membership_id, booking_id, company_id, commission_rate, base_amount,
      commission_amount, status, earned_at
    ) values (90003, '20000000-0000-0000-0000-000000000001', 90001, 10, 100, 10, 'EARNED', now())$$,
  '42501', 'permission denied for table agent_commission_transactions',
  'authenticated clients cannot insert commission rows directly'
);

reset role;

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'uq_idempotency_scope'
      and conrelid = 'public.idempotency_records'::regclass
  ),
  'idempotency scope has a database unique constraint'
);
select ok(
  to_regclass('public.idx_idempotency_expiry') is not null,
  'idempotency expiration cleanup is indexed'
);
select ok(
  exists (
    select 1 from information_schema.triggers
    where event_object_schema = 'public' and event_object_table = 'bookings'
      and trigger_name = 'booking_snapshots_immutable'
  ),
  'booking snapshots have an immutable trigger'
);
select ok(
  exists (
    select 1 from information_schema.triggers
    where event_object_schema = 'public' and event_object_table = 'passengers'
      and trigger_name = 'passenger_snapshots_immutable'
  ),
  'booking passenger snapshots have an immutable trigger'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'bookings'
      and policyname = 'bookings_authorized_read'
  ),
  'booking owner and branch reads are protected by RLS policy'
);
select ok(
  not has_table_privilege('authenticated', 'public.idempotency_records', 'SELECT')
  and not has_table_privilege('authenticated', 'public.idempotency_records', 'INSERT')
  and not has_table_privilege('authenticated', 'public.idempotency_records', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.idempotency_records', 'DELETE'),
  'authenticated clients have no idempotency table privileges'
);

select * from finish();
rollback;
