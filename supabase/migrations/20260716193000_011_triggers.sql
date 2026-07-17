create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone_number)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      nullif(new.phone, ''),
      'Voyagi user'
    ),
    nullif(new.phone, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.create_default_company_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.company_settings (company_id) values (new.id);
  return new;
end;
$$;

create trigger on_company_created
  after insert on public.companies
  for each row execute function public.create_default_company_settings();

create or replace function public.seat_layout_numbers(layout_grid jsonb)
returns table (seat_number text)
language sql
immutable
set search_path = ''
as $$
  select jsonb_array_elements_text(
    case
      when jsonb_typeof(layout_grid) = 'object' then layout_grid -> 'seat_numbers'
      else layout_grid
    end
  )
$$;

create or replace function public.validate_seat_layout_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  seat_count integer;
  distinct_seat_count integer;
  valid_labels boolean;
begin
  select count(*), count(distinct seat_number),
    coalesce(bool_and(
      btrim(seat_number) <> ''
      and seat_number = btrim(seat_number)
      and length(seat_number) <= 20
    ), false)
  into seat_count, distinct_seat_count, valid_labels
  from public.seat_layout_numbers(new.layout_grid);

  if seat_count <> new.total_seats
    or distinct_seat_count <> seat_count
    or not valid_labels then
    raise exception using
      errcode = '23514',
      message = 'seat layout must contain total_seats distinct canonical seat_numbers';
  end if;

  if tg_op = 'UPDATE' and exists (
    select 1
    from public.seat_reservations reservation
    join public.trips trip on trip.id = reservation.trip_id
    join public.buses bus on bus.id = trip.bus_id
    where bus.seat_layout_id = new.id
      and not exists (
        select 1 from public.seat_layout_numbers(new.layout_grid) seat
        where seat.seat_number = reservation.seat_number
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'seat layout update would invalidate an existing reservation';
  end if;

  return new;
end;
$$;

create trigger validate_seat_layout
  before insert or update of total_seats, layout_grid on public.seat_layouts
  for each row execute function public.validate_seat_layout_definition();

create or replace function public.validate_seat_for_trip()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  assigned_layout jsonb;
begin
  select layout.layout_grid
  into assigned_layout
  from public.trips trip
  join public.buses bus on bus.id = trip.bus_id
  join public.seat_layouts layout on layout.id = bus.seat_layout_id
  where trip.id = new.trip_id
  for key share of trip, bus, layout;

  if assigned_layout is null or not exists (
    select 1 from public.seat_layout_numbers(assigned_layout) seat
    where seat.seat_number = new.seat_number
  ) then
    raise exception using
      errcode = '23514',
      message = 'seat_number is not present in the trip bus layout';
  end if;

  return new;
end;
$$;

create trigger validate_seat_assignment
  before insert or update of trip_id, seat_number on public.seat_reservations
  for each row execute function public.validate_seat_for_trip();

create or replace function public.validate_trip_staff_types()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.driver_id is not null and not exists (
    select 1 from public.staff_members
    where id = new.driver_id and company_id = new.company_id
      and staff_type = 'DRIVER' and is_active
  ) then
    raise exception using errcode = '23514', message = 'driver_id must reference an active DRIVER';
  end if;

  if new.assistant_id is not null and not exists (
    select 1 from public.staff_members
    where id = new.assistant_id and company_id = new.company_id
      and staff_type = 'ASSISTANT' and is_active
  ) then
    raise exception using errcode = '23514', message = 'assistant_id must reference an active ASSISTANT';
  end if;

  return new;
end;
$$;

create trigger validate_trip_staff
  before insert or update of company_id, driver_id, assistant_id on public.trips
  for each row execute function public.validate_trip_staff_types();

create or replace function public.validate_payment_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  booking_total numeric(12,2);
  booking_currency char(3);
begin
  select total_amount, currency
  into booking_total, booking_currency
  from public.bookings
  where id = new.booking_id;

  if new.amount <> booking_total or new.currency <> booking_currency then
    raise exception using
      errcode = '23514',
      message = 'payment amount and currency must match the booking snapshot';
  end if;

  if new.method in ('BANKILY', 'MASRVI', 'SEDDAD')
    and new.status in ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')
    and new.provider_reference is null then
    raise exception using
      errcode = '23514',
      message = 'successful provider payments require provider_reference';
  end if;

  return new;
end;
$$;

create trigger validate_payment_snapshot
  before insert or update of booking_id, method, status, amount, currency, provider_reference
  on public.payments
  for each row execute function public.validate_payment_booking();

create or replace function public.validate_agent_commission()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  membership_user_id uuid;
  membership_rate numeric(5,2);
  booking_user_id uuid;
  booking_total numeric(12,2);
  booking_status public.booking_status_enum;
begin
  select user_id, commission_rate
  into membership_user_id, membership_rate
  from public.company_memberships
  where id = new.agent_membership_id
    and company_id = new.company_id
    and role = 'AGENT'
    and is_active;

  select booked_by_user_id, total_amount, status
  into booking_user_id, booking_total, booking_status
  from public.bookings
  where id = new.booking_id and company_id = new.company_id;

  if membership_user_id is null
    or booking_user_id is distinct from membership_user_id
    or booking_status <> 'CONFIRMED' then
    raise exception using
      errcode = '23514',
      message = 'commission requires the active agent who confirmed the booking';
  end if;

  if new.commission_rate <> membership_rate or new.base_amount <> booking_total then
    raise exception using
      errcode = '23514',
      message = 'commission rate and base must match their source snapshots';
  end if;

  return new;
end;
$$;

create trigger validate_commission_source
  before insert or update of agent_membership_id, booking_id, company_id,
    commission_rate, base_amount
  on public.agent_commission_transactions
  for each row execute function public.validate_agent_commission();

create or replace function public.prevent_row_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I is append-only; %s is forbidden', tg_table_name, tg_op);
end;
$$;

create trigger trip_events_append_only
  before update or delete on public.trip_events
  for each row execute function public.prevent_row_mutation();

create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function public.prevent_row_mutation();

create or replace function public.prevent_financial_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I records cannot be deleted', tg_table_name);
end;
$$;

create trigger bookings_no_delete before delete on public.bookings
  for each row execute function public.prevent_financial_delete();
create trigger payments_no_delete before delete on public.payments
  for each row execute function public.prevent_financial_delete();
create trigger tickets_no_delete before delete on public.tickets
  for each row execute function public.prevent_financial_delete();
create trigger commissions_no_delete before delete on public.agent_commission_transactions
  for each row execute function public.prevent_financial_delete();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'stations', 'companies', 'branches', 'company_memberships',
    'company_settings', 'seat_layouts', 'buses', 'staff_members', 'routes',
    'trips', 'bookings', 'passengers', 'seat_reservations', 'payments',
    'agent_commission_transactions', 'vehicle_maintenance_records'
  ]
  loop
    execute format(
      'create trigger set_%1$I_updated_at before update on public.%1$I '
      'for each row execute function public.set_updated_at()',
      table_name
    );
  end loop;
end;
$$;
