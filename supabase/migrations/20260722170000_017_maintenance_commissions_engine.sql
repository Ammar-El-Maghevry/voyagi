-- Phase 14: maintenance scheduling/lifecycle and commission lifecycle invariants.
-- These extend the existing Phase 1 tables without changing their identities,
-- tenant keys, financial snapshots, or deletion protections.

alter table public.vehicle_maintenance_records
  add column scheduled_ends_at timestamptz;

alter table public.vehicle_maintenance_records
  add constraint ck_maintenance_scheduled_window check (
    scheduled_ends_at is null or scheduled_ends_at > started_at
  ),
  add constraint ck_maintenance_scheduled_requires_end check (
    status <> 'SCHEDULED' or scheduled_ends_at is not null
  );

-- A bus has at most one active maintenance operation. This is the final
-- concurrency boundary; different buses remain independently schedulable.
create unique index uq_maintenance_one_active_record_per_bus
  on public.vehicle_maintenance_records (bus_id)
  where status in ('SCHEDULED', 'IN_PROGRESS');

create or replace function public.enforce_maintenance_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'SCHEDULED' then
      raise exception using
        errcode = '23514',
        message = 'maintenance records must begin SCHEDULED';
    end if;
    return new;
  end if;

  if new.status = old.status then
    -- Descriptive schedule edits are allowed only before work starts. Terminal
    -- records are preserved as operational history.
    if old.status <> 'SCHEDULED' and (
      new.maintenance_type is distinct from old.maintenance_type
      or new.description is distinct from old.description
      or new.cost_mru is distinct from old.cost_mru
      or new.odometer_km is distinct from old.odometer_km
      or new.started_at is distinct from old.started_at
      or new.scheduled_ends_at is distinct from old.scheduled_ends_at
      or new.next_maintenance_at is distinct from old.next_maintenance_at
      or new.completed_at is distinct from old.completed_at
    ) then
      raise exception using
        errcode = '55000',
        message = 'started and terminal maintenance records are immutable';
    end if;
    return new;
  end if;

  if not (
    (old.status = 'SCHEDULED' and new.status in ('IN_PROGRESS', 'CANCELLED'))
    or (old.status = 'IN_PROGRESS' and new.status in ('COMPLETED', 'CANCELLED'))
  ) then
    raise exception using
      errcode = '23514',
      message = format('illegal maintenance transition %s -> %s', old.status, new.status);
  end if;

  if new.status = 'COMPLETED' and new.completed_at is null then
    raise exception using
      errcode = '23514',
      message = 'completed maintenance requires completed_at';
  end if;

  return new;
end;
$$;

create trigger enforce_maintenance_transition
  before insert or update on public.vehicle_maintenance_records
  for each row execute function public.enforce_maintenance_transition();

create or replace function public.enforce_commission_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.agent_membership_id is distinct from old.agent_membership_id
    or new.booking_id is distinct from old.booking_id
    or new.company_id is distinct from old.company_id
    or new.commission_rate is distinct from old.commission_rate
    or new.base_amount is distinct from old.base_amount
    or new.commission_amount is distinct from old.commission_amount
    or new.currency is distinct from old.currency
    or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'commission financial snapshot is immutable';
  end if;

  if new.status = old.status then
    if new.earned_at is distinct from old.earned_at
      or new.paid_at is distinct from old.paid_at
      or new.cancelled_at is distinct from old.cancelled_at then
      raise exception using
        errcode = '55000',
        message = 'commission lifecycle timestamps are immutable outside transitions';
    end if;
    return new;
  end if;

  if not (
    (old.status = 'PENDING' and new.status in ('EARNED', 'CANCELLED'))
    or (old.status = 'EARNED' and new.status in ('PAID', 'CANCELLED'))
  ) then
    raise exception using
      errcode = '23514',
      message = format('illegal commission transition %s -> %s', old.status, new.status);
  end if;

  return new;
end;
$$;

create trigger enforce_commission_transition
  before update on public.agent_commission_transactions
  for each row execute function public.enforce_commission_transition();

-- Agents may read only their own active AGENT membership rows. Managers retain
-- company-wide reads through the existing manager predicate.
drop policy if exists commissions_tenant_read on public.agent_commission_transactions;
create policy commissions_tenant_read on public.agent_commission_transactions
  for select to authenticated using (
    private.can_manage_company(company_id)
    or exists (
      select 1
      from public.company_memberships membership
      where membership.id = agent_membership_id
        and membership.company_id = public.agent_commission_transactions.company_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'AGENT'::public.user_role_enum
        and membership.is_active
    )
  );
