create table public.seat_layouts (
  id bigint generated always as identity primary key,
  name text not null unique check (btrim(name) <> ''),
  total_seats integer not null check (total_seats > 0),
  layout_grid jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_seat_layout_grid check (jsonb_typeof(layout_grid) in ('array', 'object'))
);

create table public.buses (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies (id) on delete restrict,
  seat_layout_id bigint not null references public.seat_layouts (id) on delete restrict,
  plate_number text not null,
  bus_model text,
  status public.bus_status_enum not null default 'ACTIVE',
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_buses_company_plate unique (company_id, plate_number),
  constraint uq_buses_id_company unique (id, company_id),
  constraint ck_buses_plate check (btrim(plate_number) <> '')
);

create table public.staff_members (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies (id) on delete restrict,
  full_name text not null check (btrim(full_name) <> ''),
  phone text,
  staff_type public.staff_type_enum not null,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_staff_id_company unique (id, company_id)
);

create table public.routes (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies (id) on delete restrict,
  origin_station_id bigint not null references public.stations (id) on delete restrict,
  destination_station_id bigint not null references public.stations (id) on delete restrict,
  default_price_mru numeric(12,2) not null,
  estimated_duration_minutes integer not null,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_routes_company_stations unique (company_id, origin_station_id, destination_station_id),
  constraint uq_routes_id_company unique (id, company_id),
  constraint ck_routes_distinct_stations check (origin_station_id <> destination_station_id),
  constraint ck_routes_price check (default_price_mru >= 0),
  constraint ck_routes_duration check (estimated_duration_minutes > 0)
);

create table public.route_price_history (
  id bigint generated always as identity primary key,
  route_id bigint not null references public.routes (id) on delete restrict,
  price_mru numeric(12,2) not null check (price_mru >= 0),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  changed_by_user_id uuid references public.profiles (id) on delete set null,
  change_reason text,
  created_at timestamptz not null default now(),
  constraint ck_route_price_period check (effective_to is null or effective_to > effective_from),
  constraint ex_route_price_periods exclude using gist (
    route_id with =,
    tstzrange(effective_from, effective_to, '[)') with &&
  )
);

create unique index uq_route_open_price_period
  on public.route_price_history (route_id) where effective_to is null;
