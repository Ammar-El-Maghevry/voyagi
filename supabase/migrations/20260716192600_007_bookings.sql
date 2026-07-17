create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_reference text not null unique,
  trip_id bigint not null,
  company_id bigint not null,
  branch_id bigint,
  booked_by_user_id uuid references public.profiles (id) on delete set null,
  booking_channel public.booking_channel_enum not null,
  status public.booking_status_enum not null default 'DRAFT',
  subtotal_amount numeric(12,2) not null default 0,
  service_fee_amount numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  currency char(3) not null default 'MRU',
  expires_at timestamptz,
  idempotency_key text,
  cancellation_policy_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_bookings_id_trip unique (id, trip_id),
  constraint uq_bookings_id_company unique (id, company_id),
  constraint fk_bookings_trip_company foreign key (trip_id, company_id)
    references public.trips (id, company_id) on delete restrict,
  constraint fk_bookings_branch_company foreign key (branch_id, company_id)
    references public.branches (id, company_id) on delete restrict,
  constraint ck_bookings_reference check (btrim(booking_reference) <> ''),
  constraint ck_bookings_idempotency_key check (
    idempotency_key is null or btrim(idempotency_key) <> ''
  ),
  constraint ck_bookings_amounts check (
    subtotal_amount >= 0 and service_fee_amount >= 0 and discount_amount >= 0
    and total_amount >= 0
    and total_amount = subtotal_amount + service_fee_amount - discount_amount
  ),
  constraint ck_bookings_currency check (currency ~ '^[A-Z]{3}$'),
  constraint ck_bookings_policy_snapshot check (
    jsonb_typeof(cancellation_policy_snapshot) = 'object'
  )
);

create unique index uq_bookings_idempotency_key
  on public.bookings (idempotency_key) where idempotency_key is not null;

create table public.passengers (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings (id) on delete restrict,
  full_name text not null check (btrim(full_name) <> ''),
  phone text,
  document_number text,
  boarding_station_id bigint references public.stations (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_passengers_id_booking unique (id, booking_id)
);

create table public.seat_reservations (
  id bigint generated always as identity primary key,
  trip_id bigint not null references public.trips (id) on delete restrict,
  booking_id uuid not null,
  passenger_id bigint,
  seat_number varchar(20) not null,
  status public.seat_reservation_status_enum not null,
  held_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_seat_reservations_id_booking unique (id, booking_id),
  constraint uq_seat_reservations_ticket_identity unique (id, booking_id, passenger_id),
  constraint fk_seat_booking_trip foreign key (booking_id, trip_id)
    references public.bookings (id, trip_id) on delete restrict,
  constraint fk_seat_passenger_booking foreign key (passenger_id, booking_id)
    references public.passengers (id, booking_id) on delete restrict,
  constraint ck_seat_number check (
    btrim(seat_number) <> '' and seat_number = btrim(seat_number)
  ),
  constraint ck_seat_hold_expiry check (
    (status = 'HELD' and held_until is not null)
    or (status <> 'HELD')
  )
);

create unique index uq_active_seat_per_trip
  on public.seat_reservations (trip_id, seat_number)
  where status in ('HELD', 'CONFIRMED', 'CHECKED_IN');

create unique index uq_seat_passenger
  on public.seat_reservations (passenger_id) where passenger_id is not null;
