create type public.booking_source_enum as enum ('APP', 'WEB', 'AGENT', 'ADMIN', 'API');
create type public.booking_event_type_enum as enum (
  'BOOKING_CREATED',
  'PAYMENT_PENDING',
  'PAYMENT_CONFIRMED',
  'CHECKED_IN',
  'BOARDING',
  'CANCELLED',
  'REFUND_CREATED',
  'REFUND_COMPLETED'
);

do $$
begin
  if exists (
    select 1
    from (
      select phone_number as phone from public.profiles
      union all select contact_phone from public.companies
      union all select phone from public.branches
      union all select support_phone from public.company_settings
      union all select support_whatsapp from public.company_settings
      union all select phone from public.staff_members
      union all select phone from public.passengers
    ) existing_phones
    where phone is not null and phone !~ '^\+?[0-9]{8,20}$'
  ) then
    raise exception using
      errcode = '23514',
      message = 'existing phone values must be normalized before production hardening';
  end if;
end;
$$;

alter table public.profiles
  alter column phone_number type varchar(21) using phone_number::varchar(21),
  add constraint ck_profiles_phone check (
    phone_number is null or phone_number ~ '^\+?[0-9]{8,20}$'
  );

alter table public.companies
  alter column contact_phone type varchar(21) using contact_phone::varchar(21),
  add constraint ck_companies_phone check (
    contact_phone is null or contact_phone ~ '^\+?[0-9]{8,20}$'
  );

alter table public.branches
  alter column phone type varchar(21) using phone::varchar(21),
  add constraint ck_branches_phone check (
    phone is null or phone ~ '^\+?[0-9]{8,20}$'
  );

alter table public.company_settings
  alter column support_phone type varchar(21) using support_phone::varchar(21),
  alter column support_whatsapp type varchar(21) using support_whatsapp::varchar(21),
  add constraint ck_company_settings_support_phone check (
    support_phone is null or support_phone ~ '^\+?[0-9]{8,20}$'
  ),
  add constraint ck_company_settings_support_whatsapp check (
    support_whatsapp is null or support_whatsapp ~ '^\+?[0-9]{8,20}$'
  );

alter table public.staff_members
  alter column phone type varchar(21) using phone::varchar(21),
  add constraint ck_staff_phone check (
    phone is null or phone ~ '^\+?[0-9]{8,20}$'
  );

alter table public.passengers
  alter column phone type varchar(21) using phone::varchar(21),
  add constraint ck_passengers_phone check (
    phone is null or phone ~ '^\+?[0-9]{8,20}$'
  );

alter table public.routes
  add column distance_km numeric(8,2) not null default 0,
  add column currency char(3) not null default 'MRU',
  add constraint ck_routes_distance check (distance_km >= 0),
  add constraint ck_routes_currency check (currency ~ '^[A-Z]{3}$');

alter table public.route_price_history
  add column currency char(3) not null default 'MRU',
  add constraint ck_route_price_history_currency check (currency ~ '^[A-Z]{3}$');

alter table public.buses
  add column current_odometer_km integer not null default 0,
  add column version integer not null default 1,
  add constraint ck_buses_current_odometer check (current_odometer_km >= 0),
  add constraint ck_buses_version check (version > 0);

alter table public.trips
  add column currency char(3) not null default 'MRU',
  add column actual_departure_time timestamptz,
  add column actual_arrival_time timestamptz,
  add column version integer not null default 1,
  add constraint ck_trips_currency check (currency ~ '^[A-Z]{3}$'),
  add constraint ck_trips_actual_times check (
    actual_arrival_time is null
    or (
      actual_departure_time is not null
      and actual_arrival_time >= actual_departure_time
    )
  ),
  add constraint ck_trips_version check (version > 0);

alter table public.bookings
  add column booking_source public.booking_source_enum;

update public.bookings
set booking_source = case booking_channel
  when 'MOBILE_APP' then 'APP'::public.booking_source_enum
  when 'WEB' then 'WEB'::public.booking_source_enum
  when 'AGENT' then 'AGENT'::public.booking_source_enum
  when 'BRANCH_OFFICE' then 'ADMIN'::public.booking_source_enum
  when 'ADMIN' then 'ADMIN'::public.booking_source_enum
end;

alter table public.bookings
  alter column booking_source set not null,
  add column ticket_price_snapshot numeric(12,2),
  add column version integer not null default 1,
  add constraint ck_bookings_ticket_price_snapshot check (ticket_price_snapshot >= 0),
  add constraint ck_bookings_version check (version > 0);

update public.bookings booking
set ticket_price_snapshot = trip.price_mru
from public.trips trip
where trip.id = booking.trip_id;

create or replace function public.set_booking_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.booking_source is null then
    new.booking_source := case new.booking_channel
      when 'MOBILE_APP' then 'APP'::public.booking_source_enum
      when 'WEB' then 'WEB'::public.booking_source_enum
      when 'AGENT' then 'AGENT'::public.booking_source_enum
      when 'BRANCH_OFFICE' then 'ADMIN'::public.booking_source_enum
      when 'ADMIN' then 'ADMIN'::public.booking_source_enum
    end;
  end if;

  return new;
end;
$$;

create trigger set_booking_source
  before insert on public.bookings
  for each row execute function public.set_booking_source();

create or replace function public.set_booking_ticket_price_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ticket_price_snapshot is null then
    select trip.price_mru
    into new.ticket_price_snapshot
    from public.trips trip
    where trip.id = new.trip_id;
  end if;

  return new;
end;
$$;

create trigger set_booking_ticket_price_snapshot
  before insert on public.bookings
  for each row execute function public.set_booking_ticket_price_snapshot();

alter table public.bookings
  alter column ticket_price_snapshot set not null;

alter table public.agent_commission_transactions
  add column currency char(3) not null default 'MRU',
  add constraint ck_commissions_currency check (currency ~ '^[A-Z]{3}$');

alter table public.vehicle_maintenance_records
  add column currency char(3) not null default 'MRU',
  add constraint ck_maintenance_currency check (currency ~ '^[A-Z]{3}$');

alter table public.audit_logs
  add column device_type text,
  add column operating_system text,
  add column browser text;

create table public.booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null,
  company_id bigint not null,
  actor_user_id uuid references public.profiles (id) on delete restrict,
  event_type public.booking_event_type_enum not null,
  event_time timestamptz not null default now(),
  metadata jsonb,
  created_at timestamptz not null default now(),
  constraint fk_booking_events_booking_company foreign key (booking_id, company_id)
    references public.bookings (id, company_id) on delete restrict,
  constraint ck_booking_events_metadata check (
    metadata is null or jsonb_typeof(metadata) = 'object'
  )
);

create index idx_booking_events_booking
  on public.booking_events (booking_id, event_time desc);
create index idx_booking_events_company
  on public.booking_events (company_id, event_time desc);
create index idx_booking_events_actor
  on public.booking_events (actor_user_id) where actor_user_id is not null;
create index idx_bookings_source_analytics
  on public.bookings (company_id, booking_source, created_at desc);

create trigger booking_events_append_only
  before update or delete on public.booking_events
  for each row execute function public.prevent_row_mutation();

revoke all on public.booking_events from anon, authenticated;
grant select on public.booking_events to authenticated;
alter table public.booking_events enable row level security;

create policy booking_events_authorized_read on public.booking_events
  for select to authenticated using (private.can_access_booking(booking_id));
