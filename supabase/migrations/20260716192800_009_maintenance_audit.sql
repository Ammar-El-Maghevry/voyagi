create table public.vehicle_maintenance_records (
  id bigint generated always as identity primary key,
  bus_id bigint not null,
  company_id bigint not null,
  maintenance_type public.maintenance_type_enum not null,
  description text,
  status public.maintenance_status_enum not null default 'SCHEDULED',
  cost_mru numeric(12,2),
  odometer_km integer,
  started_at timestamptz not null,
  completed_at timestamptz,
  next_maintenance_at timestamptz,
  created_by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_maintenance_bus_company foreign key (bus_id, company_id)
    references public.buses (id, company_id) on delete restrict,
  constraint ck_maintenance_cost check (cost_mru is null or cost_mru >= 0),
  constraint ck_maintenance_odometer check (odometer_km is null or odometer_km >= 0),
  constraint ck_maintenance_completed check (completed_at is null or completed_at >= started_at),
  constraint ck_maintenance_status_completed check (
    status <> 'COMPLETED' or completed_at is not null
  )
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles (id) on delete restrict,
  company_id bigint references public.companies (id) on delete restrict,
  action text not null check (btrim(action) <> ''),
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id text not null check (btrim(entity_id) <> ''),
  old_values jsonb,
  new_values jsonb,
  ip_address inet,
  user_agent text,
  request_id uuid,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  constraint ck_audit_old_values check (old_values is null or jsonb_typeof(old_values) = 'object'),
  constraint ck_audit_new_values check (new_values is null or jsonb_typeof(new_values) = 'object')
);
