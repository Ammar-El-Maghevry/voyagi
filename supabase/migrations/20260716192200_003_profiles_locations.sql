create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (btrim(full_name) <> ''),
  phone_number text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cities (
  id bigint generated always as identity primary key,
  name_ar text not null,
  name_fr text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint uq_cities_names unique (name_ar, name_fr),
  constraint ck_cities_names check (btrim(name_ar) <> '' and btrim(name_fr) <> '')
);

create table public.stations (
  id bigint generated always as identity primary key,
  city_id bigint not null references public.cities (id) on delete restrict,
  name_ar text not null,
  name_fr text not null,
  latitude numeric(9,6),
  longitude numeric(9,6),
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_stations_city_names unique (city_id, name_ar, name_fr),
  constraint ck_stations_names check (btrim(name_ar) <> '' and btrim(name_fr) <> ''),
  constraint ck_stations_latitude check (latitude is null or latitude between -90 and 90),
  constraint ck_stations_longitude check (longitude is null or longitude between -180 and 180)
);
