begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

-- ---------------------------------------------------------------------------
-- Fixtures (ids in the 905xx range to avoid clashing with other test files).
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000501',
   'authenticated', 'authenticated', 'pt-manager@voyagi.test', '', now(), now(), now(),
   '{}', '{"full_name":"PT Manager"}'),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000502',
   'authenticated', 'authenticated', 'pt-owner@voyagi.test', '', now(), now(), now(),
   '{}', '{"full_name":"PT Owner"}');

insert into public.cities (id, name_ar, name_fr) overriding system value
values (90501, 'مدينة الدفع', 'Pay City');
insert into public.stations (id, city_id, name_ar, name_fr) overriding system value
values (90501, 90501, 'محطة أ', 'Station A'), (90502, 90501, 'محطة ب', 'Station B');
insert into public.companies (id, name) overriding system value values (90501, 'PT Company');
insert into public.branches (id, company_id, city_id, name_ar, name_fr) overriding system value
values (90501, 90501, 90501, 'فرع', 'Branch');
insert into public.company_memberships (id, user_id, company_id, branch_id, role, commission_rate)
  overriding system value
values (90501, '10000000-0000-0000-0000-000000000501', 90501, null, 'COMPANY_MANAGER', 0);
insert into public.seat_layouts (id, name, total_seats, layout_grid) overriding system value
values (90501, 'PT Layout', 2, '["1", "2"]');
insert into public.buses (id, company_id, seat_layout_id, plate_number) overriding system value
values (90501, 90501, 90501, 'PT-A');
insert into public.routes (
  id, company_id, origin_station_id, destination_station_id,
  default_price_mru, estimated_duration_minutes
) overriding system value
values (90501, 90501, 90501, 90502, 100, 60);
insert into public.trips (
  id, company_id, route_id, bus_id, departure_time,
  estimated_arrival_time, price_mru, boarding_closes_at
) overriding system value
values (90501, 90501, 90501, 90501, now() + interval '1 day',
        now() + interval '1 day 1 hour', 100, now() + interval '23 hours');

insert into public.bookings (
  id, booking_reference, trip_id, company_id, branch_id, booked_by_user_id,
  booking_channel, status, subtotal_amount, total_amount
)
values ('20000000-0000-0000-0000-000000000501', 'PT-B1', 90501, 90501, null,
        '10000000-0000-0000-0000-000000000502', 'WEB', 'CONFIRMED', 100, 100);

insert into public.passengers (id, booking_id, full_name) overriding system value
values (90501, '20000000-0000-0000-0000-000000000501', 'PT Passenger One'),
       (90502, '20000000-0000-0000-0000-000000000501', 'PT Passenger Two');
insert into public.seat_reservations (id, trip_id, booking_id, passenger_id, seat_number, status)
  overriding system value
values (90501, 90501, '20000000-0000-0000-0000-000000000501', 90501, '1', 'CONFIRMED'),
       (90502, 90501, '20000000-0000-0000-0000-000000000501', 90502, '2', 'CONFIRMED');

-- ---------------------------------------------------------------------------
-- Payment lifecycle (migration 016 enforce_payment_transition).
-- ---------------------------------------------------------------------------
insert into public.payments (id, booking_id, method, status, amount, currency, internal_reference)
values ('30000000-0000-0000-0000-000000000501',
        '20000000-0000-0000-0000-000000000501', 'BANKILY', 'PENDING', 100, 'MRU', 'PT-PAY-1');
insert into public.payments (id, booking_id, method, status, amount, currency, internal_reference)
values ('30000000-0000-0000-0000-000000000502',
        '20000000-0000-0000-0000-000000000501', 'BANKILY', 'PENDING', 100, 'MRU', 'PT-PAY-2');

select lives_ok(
  $$update public.payments set status = 'PROCESSING', provider_reference = 'prov-1'
      where id = '30000000-0000-0000-0000-000000000501'$$,
  'payment PENDING -> PROCESSING is allowed'
);
select throws_ok(
  $$update public.payments set status = 'REFUNDED'
      where id = '30000000-0000-0000-0000-000000000502'$$,
  '23514', 'illegal payment transition PENDING -> REFUNDED',
  'PENDING -> REFUNDED is rejected by the transition trigger'
);
select lives_ok(
  $$update public.payments set status = 'SUCCEEDED', paid_at = now()
      where id = '30000000-0000-0000-0000-000000000501'$$,
  'payment PROCESSING -> SUCCEEDED is allowed'
);
select throws_ok(
  $$insert into public.payments (booking_id, method, status, amount, currency,
        internal_reference, confirmed_by_user_id, paid_at)
    values ('20000000-0000-0000-0000-000000000501', 'CASH', 'SUCCEEDED', 100, 'MRU',
        'PT-PAY-DUP', '10000000-0000-0000-0000-000000000501', now())$$,
  '23505', 'duplicate key value violates unique constraint "uq_successful_payment_per_booking"',
  'a booking cannot have two settled payments'
);
select throws_ok(
  $$update public.payments set status = 'PARTIALLY_REFUNDED'
      where id = '30000000-0000-0000-0000-000000000501'$$,
  '23514', 'illegal payment transition SUCCEEDED -> PARTIALLY_REFUNDED',
  'PARTIALLY_REFUNDED is unreachable (full-refund-only scope)'
);
select throws_ok(
  $$update public.payments set amount = 999
      where id = '30000000-0000-0000-0000-000000000501'$$,
  '55000', 'payment identity and amount are immutable',
  'a settled payment amount cannot be mutated'
);
select throws_ok(
  $$update public.payments set provider_reference = null
      where id = '30000000-0000-0000-0000-000000000501'$$,
  '55000', 'provider_reference is write-once and cannot change',
  'provider_reference cannot be cleared once stored'
);
select lives_ok(
  $$update public.payments set status = 'REFUNDED'
      where id = '30000000-0000-0000-0000-000000000501'$$,
  'payment SUCCEEDED -> REFUNDED (full refund) is allowed'
);
select throws_ok(
  $$update public.payments set status = 'SUCCEEDED'
      where id = '30000000-0000-0000-0000-000000000501'$$,
  '23514', 'illegal payment transition REFUNDED -> SUCCEEDED',
  'REFUNDED is terminal'
);

-- ---------------------------------------------------------------------------
-- Ticket lifecycle (migration 016 enforce_ticket_lifecycle).
-- ---------------------------------------------------------------------------
insert into public.tickets (id, booking_id, passenger_id, seat_reservation_id,
    ticket_number, qr_token_hash)
values ('40000000-0000-0000-0000-000000000501',
        '20000000-0000-0000-0000-000000000501', 90501, 90501, 'PT-TKT-1', 'hash-1');
select ok(true, 'a ticket can be issued for a confirmed seat');

select throws_ok(
  $$insert into public.tickets (booking_id, passenger_id, seat_reservation_id,
        ticket_number, qr_token_hash)
    values ('20000000-0000-0000-0000-000000000501', 90501, 90501, 'PT-TKT-DUP', 'hash-dup')$$,
  '23505', null,
  'a seat reservation cannot be ticketed twice'
);
select throws_ok(
  $$update public.tickets set qr_token_hash = 'tampered'
      where id = '40000000-0000-0000-0000-000000000501'$$,
  '55000', 'ticket issuance snapshot is immutable',
  'the QR token hash is immutable'
);
select lives_ok(
  $$update public.tickets set checked_in_at = now()
      where id = '40000000-0000-0000-0000-000000000501'$$,
  'a ticket can be checked in (validated)'
);
select throws_ok(
  $$update public.tickets set cancelled_at = now()
      where id = '40000000-0000-0000-0000-000000000501'$$,
  '23514', 'a ticket cannot be both checked-in and cancelled',
  'a checked-in ticket cannot also be cancelled'
);

insert into public.tickets (id, booking_id, passenger_id, seat_reservation_id,
    ticket_number, qr_token_hash)
values ('40000000-0000-0000-0000-000000000502',
        '20000000-0000-0000-0000-000000000501', 90502, 90502, 'PT-TKT-2', 'hash-2');
select lives_ok(
  $$update public.tickets set cancelled_at = now()
      where id = '40000000-0000-0000-0000-000000000502'$$,
  'an issued ticket can be revoked'
);
select throws_ok(
  $$update public.tickets set checked_in_at = now()
      where id = '40000000-0000-0000-0000-000000000502'$$,
  '55000', 'a cancelled ticket is terminal',
  'a revoked ticket cannot later be checked in'
);

-- ---------------------------------------------------------------------------
-- Direct-write denial and read grants for the non-privileged role.
-- ---------------------------------------------------------------------------
select is(
  has_table_privilege('authenticated', 'public.payments', 'INSERT'),
  false, 'authenticated cannot directly write payments'
);
select is(
  has_table_privilege('authenticated', 'public.tickets', 'INSERT'),
  false, 'authenticated cannot directly write tickets'
);
select is(
  has_table_privilege('authenticated', 'public.payments', 'SELECT')
    and has_table_privilege('authenticated', 'public.tickets', 'SELECT'),
  true, 'authenticated may read payments and tickets (subject to RLS)'
);

select * from finish();
rollback;
