create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role' = 'SUPER_ADMIN', false)
$$;

create or replace function private.has_company_access(target_company_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin() or exists (
    select 1
    from public.company_memberships membership
    where membership.user_id = auth.uid()
      and membership.company_id = target_company_id
      and membership.is_active
      and membership.role in ('COMPANY_MANAGER', 'BRANCH_EMPLOYEE', 'AGENT')
  )
$$;

create or replace function private.can_manage_company(target_company_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin() or exists (
    select 1
    from public.company_memberships membership
    where membership.user_id = auth.uid()
      and membership.company_id = target_company_id
      and membership.role = 'COMPANY_MANAGER'
      and membership.is_active
  )
$$;

create or replace function private.has_branch_access(
  target_company_id bigint,
  target_branch_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin() or exists (
    select 1
    from public.company_memberships membership
    where membership.user_id = auth.uid()
      and membership.company_id = target_company_id
      and membership.is_active
      and (
        membership.role = 'COMPANY_MANAGER'
        or (
          membership.role in ('BRANCH_EMPLOYEE', 'AGENT')
          and target_branch_id is not null
          and membership.branch_id = target_branch_id
        )
      )
  )
$$;

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
        booking.booked_by_user_id = auth.uid()
        or private.has_branch_access(booking.company_id, booking.branch_id)
      )
  )
$$;

grant usage on schema private to authenticated, service_role;
grant execute on all functions in schema private to authenticated, service_role;
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant update (full_name, phone_number) on public.profiles to authenticated;

alter table public.profiles enable row level security;
alter table public.cities enable row level security;
alter table public.stations enable row level security;
alter table public.companies enable row level security;
alter table public.branches enable row level security;
alter table public.company_memberships enable row level security;
alter table public.company_settings enable row level security;
alter table public.seat_layouts enable row level security;
alter table public.buses enable row level security;
alter table public.staff_members enable row level security;
alter table public.routes enable row level security;
alter table public.route_price_history enable row level security;
alter table public.trips enable row level security;
alter table public.trip_events enable row level security;
alter table public.bookings enable row level security;
alter table public.passengers enable row level security;
alter table public.seat_reservations enable row level security;
alter table public.payments enable row level security;
alter table public.tickets enable row level security;
alter table public.agent_commission_transactions enable row level security;
alter table public.vehicle_maintenance_records enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select_self on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_self on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy cities_read_active on public.cities
  for select to authenticated using (is_active);
create policy stations_read_active on public.stations
  for select to authenticated using (is_active and deleted_at is null);
create policy seat_layouts_read on public.seat_layouts
  for select to authenticated using (true);

create policy companies_tenant_read on public.companies
  for select to authenticated using (private.has_company_access(id));
create policy branches_tenant_read on public.branches
  for select to authenticated using (private.has_branch_access(company_id, id));
create policy memberships_tenant_read on public.company_memberships
  for select to authenticated using (
    user_id = (select auth.uid()) or private.can_manage_company(company_id)
  );
create policy company_settings_tenant_read on public.company_settings
  for select to authenticated using (private.has_company_access(company_id));
create policy buses_tenant_read on public.buses
  for select to authenticated using (private.has_company_access(company_id));
create policy staff_tenant_read on public.staff_members
  for select to authenticated using (private.has_company_access(company_id));
create policy routes_tenant_read on public.routes
  for select to authenticated using (private.has_company_access(company_id));
create policy route_prices_tenant_read on public.route_price_history
  for select to authenticated using (
    exists (
      select 1 from public.routes route
      where route.id = route_id and private.has_company_access(route.company_id)
    )
  );
create policy trips_tenant_read on public.trips
  for select to authenticated using (private.has_company_access(company_id));
create policy trip_events_tenant_read on public.trip_events
  for select to authenticated using (private.has_company_access(company_id));

create policy bookings_authorized_read on public.bookings
  for select to authenticated using (
    booked_by_user_id = (select auth.uid())
    or private.has_branch_access(company_id, branch_id)
  );
create policy passengers_authorized_read on public.passengers
  for select to authenticated using (private.can_access_booking(booking_id));
create policy seats_authorized_read on public.seat_reservations
  for select to authenticated using (private.can_access_booking(booking_id));
create policy payments_authorized_read on public.payments
  for select to authenticated using (private.can_access_booking(booking_id));
create policy tickets_authorized_read on public.tickets
  for select to authenticated using (private.can_access_booking(booking_id));
create policy commissions_tenant_read on public.agent_commission_transactions
  for select to authenticated using (
    private.can_manage_company(company_id)
    or exists (
      select 1 from public.company_memberships membership
      where membership.id = agent_membership_id
        and membership.user_id = (select auth.uid())
    )
  );
create policy maintenance_tenant_read on public.vehicle_maintenance_records
  for select to authenticated using (private.has_company_access(company_id));
create policy audit_manager_read on public.audit_logs
  for select to authenticated using (
    private.is_super_admin()
    or (company_id is not null and private.can_manage_company(company_id))
  );
