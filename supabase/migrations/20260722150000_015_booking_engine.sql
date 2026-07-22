create type public.passenger_gender_enum as enum ('MALE', 'FEMALE', 'UNSPECIFIED');

alter table public.passengers
  add column gender public.passenger_gender_enum not null default 'UNSPECIFIED';

create or replace function public.prevent_passenger_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.booking_id is distinct from old.booking_id
    or new.full_name is distinct from old.full_name
    or new.phone is distinct from old.phone
    or new.document_number is distinct from old.document_number
    or new.boarding_station_id is distinct from old.boarding_station_id
    or new.gender is distinct from old.gender
    or new.created_at is distinct from old.created_at
  then
    raise exception using
      errcode = '55000',
      message = 'booking passenger snapshots are immutable';
  end if;

  return new;
end;
$$;

create trigger passenger_snapshots_immutable
  before update on public.passengers
  for each row execute function public.prevent_passenger_snapshot_mutation();

alter type public.booking_event_type_enum add value if not exists 'EXPIRED';
alter type public.booking_event_type_enum add value if not exists 'PARTIALLY_CANCELLED';
alter type public.booking_event_type_enum add value if not exists 'COMPLETED';

create table public.idempotency_records (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies (id) on delete restrict,
  actor_user_id uuid not null references public.profiles (id) on delete restrict,
  operation text not null,
  idempotency_key text not null,
  request_fingerprint char(64) not null,
  booking_id uuid,
  response_status smallint,
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  constraint fk_idempotency_booking_company foreign key (booking_id, company_id)
    references public.bookings (id, company_id) on delete restrict,
  constraint uq_idempotency_scope unique (
    company_id, actor_user_id, operation, idempotency_key
  ),
  constraint ck_idempotency_operation check (btrim(operation) <> ''),
  constraint ck_idempotency_key check (
    btrim(idempotency_key) <> '' and length(idempotency_key) <= 255
  ),
  constraint ck_idempotency_fingerprint check (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint ck_idempotency_completion check (
    (booking_id is null and response_status is null and completed_at is null)
    or (booking_id is not null and response_status is not null and completed_at is not null)
  )
);

insert into public.idempotency_records (
  company_id, actor_user_id, operation, idempotency_key, request_fingerprint,
  booking_id, response_status, completed_at, expires_at, created_at
)
select
  company_id,
  booked_by_user_id,
  case
    when booking_channel in ('WEB', 'MOBILE_APP') then 'CREATE_PASSENGER_BOOKING'
    else 'CREATE_AGENT_BOOKING'
  end,
  idempotency_key,
  encode(digest('legacy:' || idempotency_key, 'sha256'), 'hex'),
  id,
  201,
  created_at,
  created_at + interval '24 hours',
  created_at
from public.bookings
where idempotency_key is not null and booked_by_user_id is not null
on conflict (company_id, actor_user_id, operation, idempotency_key) do nothing;

create index idx_idempotency_expiry
  on public.idempotency_records (expires_at);
create index idx_bookings_expiration
  on public.bookings (expires_at, id)
  where status in ('HELD', 'PENDING_PAYMENT');
create index idx_bookings_company_status
  on public.bookings (company_id, status, created_at desc);
create index idx_bookings_owner_status
  on public.bookings (booked_by_user_id, status, created_at desc)
  where booked_by_user_id is not null;

create or replace function public.prevent_booking_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.booking_reference is distinct from old.booking_reference
    or new.trip_id is distinct from old.trip_id
    or new.company_id is distinct from old.company_id
    or new.branch_id is distinct from old.branch_id
    or new.booked_by_user_id is distinct from old.booked_by_user_id
    or new.booking_channel is distinct from old.booking_channel
    or new.booking_source is distinct from old.booking_source
    or new.subtotal_amount is distinct from old.subtotal_amount
    or new.service_fee_amount is distinct from old.service_fee_amount
    or new.discount_amount is distinct from old.discount_amount
    or new.total_amount is distinct from old.total_amount
    or new.currency is distinct from old.currency
    or new.cancellation_policy_snapshot is distinct from old.cancellation_policy_snapshot
    or new.ticket_price_snapshot is distinct from old.ticket_price_snapshot
    or new.created_at is distinct from old.created_at
  then
    raise exception using
      errcode = '55000',
      message = 'booking price and source snapshots are immutable';
  end if;

  return new;
end;
$$;

create trigger booking_snapshots_immutable
  before update on public.bookings
  for each row execute function public.prevent_booking_snapshot_mutation();

revoke all on public.idempotency_records from anon, authenticated;
alter table public.idempotency_records enable row level security;

create or replace function private.can_access_booking(target_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.bookings booking
    where booking.id = target_booking_id
      and (
        (
          booking.booking_channel in ('MOBILE_APP', 'WEB')
          and booking.booked_by_user_id = auth.uid()
        )
        or private.has_branch_access(booking.company_id, booking.branch_id)
      )
  )
$$;

drop policy bookings_authorized_read on public.bookings;
create policy bookings_authorized_read on public.bookings
  for select to authenticated using (
    (
      booking_channel in ('MOBILE_APP', 'WEB')
      and booked_by_user_id = (select auth.uid())
    )
    or private.has_branch_access(company_id, branch_id)
  );
