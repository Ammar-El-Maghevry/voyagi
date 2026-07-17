create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  method public.payment_method_enum not null,
  status public.payment_status_enum not null default 'PENDING',
  amount numeric(12,2) not null check (amount >= 0),
  currency char(3) not null default 'MRU' check (currency ~ '^[A-Z]{3}$'),
  provider_reference text,
  internal_reference text not null unique check (btrim(internal_reference) <> ''),
  confirmed_by_user_id uuid references public.profiles (id) on delete restrict,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_payments_provider_reference check (
    provider_reference is null or btrim(provider_reference) <> ''
  ),
  constraint ck_payments_cash_confirmation check (
    method <> 'CASH' or status not in ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')
    or (confirmed_by_user_id is not null and paid_at is not null)
  ),
  constraint ck_payments_success_paid_at check (
    status not in ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED') or paid_at is not null
  )
);

create unique index uq_payment_provider_ref
  on public.payments (method, provider_reference)
  where provider_reference is not null;

create unique index uq_successful_payment_per_booking
  on public.payments (booking_id)
  where status in ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED');

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  passenger_id bigint not null,
  seat_reservation_id bigint not null,
  ticket_number text not null unique check (btrim(ticket_number) <> ''),
  qr_token_hash text not null unique check (btrim(qr_token_hash) <> ''),
  issued_at timestamptz not null default now(),
  checked_in_at timestamptz,
  cancelled_at timestamptz,
  constraint uq_ticket_booking_passenger unique (booking_id, passenger_id),
  constraint uq_ticket_seat unique (seat_reservation_id),
  constraint fk_ticket_passenger_booking foreign key (passenger_id, booking_id)
    references public.passengers (id, booking_id) on delete restrict,
  constraint fk_ticket_seat_passenger foreign key (
    seat_reservation_id, booking_id, passenger_id
  ) references public.seat_reservations (id, booking_id, passenger_id) on delete restrict
);

create table public.agent_commission_transactions (
  id uuid primary key default gen_random_uuid(),
  agent_membership_id bigint not null,
  booking_id uuid not null,
  company_id bigint not null,
  commission_rate numeric(5,2) not null,
  base_amount numeric(12,2) not null,
  commission_amount numeric(12,2) not null,
  status public.commission_status_enum not null default 'PENDING',
  earned_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_commission_per_agent_booking unique (agent_membership_id, booking_id),
  constraint fk_commission_membership_company foreign key (agent_membership_id, company_id)
    references public.company_memberships (id, company_id) on delete restrict,
  constraint fk_commission_booking_company foreign key (booking_id, company_id)
    references public.bookings (id, company_id) on delete restrict,
  constraint ck_commission_rate check (commission_rate between 0 and 100),
  constraint ck_commission_base check (base_amount >= 0),
  constraint ck_commission_amount check (
    commission_amount >= 0
    and commission_amount = round(base_amount * commission_rate / 100, 2)
  ),
  constraint ck_commission_timestamps check (
    (status not in ('EARNED', 'PAID') or earned_at is not null)
    and (status <> 'PAID' or paid_at is not null)
    and (status <> 'CANCELLED' or cancelled_at is not null)
  )
);
