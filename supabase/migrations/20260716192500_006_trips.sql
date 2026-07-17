create table public.trips (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies (id) on delete restrict,
  route_id bigint not null,
  bus_id bigint not null,
  driver_id bigint,
  assistant_id bigint,
  departure_time timestamptz not null,
  estimated_arrival_time timestamptz not null,
  price_mru numeric(12,2) not null,
  status public.trip_status_enum not null default 'SCHEDULED',
  boarding_closes_at timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_trips_id_company unique (id, company_id),
  constraint fk_trips_route_company foreign key (route_id, company_id)
    references public.routes (id, company_id) on delete restrict,
  constraint fk_trips_bus_company foreign key (bus_id, company_id)
    references public.buses (id, company_id) on delete restrict,
  constraint fk_trips_driver_company foreign key (driver_id, company_id)
    references public.staff_members (id, company_id) on delete restrict,
  constraint fk_trips_assistant_company foreign key (assistant_id, company_id)
    references public.staff_members (id, company_id) on delete restrict,
  constraint ck_trips_times check (
    estimated_arrival_time > departure_time and boarding_closes_at <= departure_time
  ),
  constraint ck_trips_price check (price_mru >= 0),
  constraint ck_trips_distinct_staff check (
    driver_id is null or assistant_id is null or driver_id <> assistant_id
  )
);

create table public.trip_events (
  id bigint generated always as identity primary key,
  trip_id bigint not null,
  company_id bigint not null,
  actor_user_id uuid references public.profiles (id) on delete restrict,
  event_type public.trip_event_type_enum not null,
  event_source public.trip_event_source_enum not null,
  event_time timestamptz not null default now(),
  metadata jsonb,
  created_at timestamptz not null default now(),
  constraint fk_trip_events_trip_company foreign key (trip_id, company_id)
    references public.trips (id, company_id) on delete restrict,
  constraint ck_trip_events_metadata check (metadata is null or jsonb_typeof(metadata) = 'object')
);
