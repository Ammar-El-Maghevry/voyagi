create table public.companies (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  logo_url text,
  contact_phone text,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branches (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies (id) on delete restrict,
  city_id bigint not null references public.cities (id) on delete restrict,
  name_ar text not null,
  name_fr text not null,
  phone text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_branches_company_names unique (company_id, name_ar, name_fr),
  constraint uq_branches_id_company unique (id, company_id),
  constraint ck_branches_names check (btrim(name_ar) <> '' and btrim(name_fr) <> '')
);

create table public.company_memberships (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete restrict,
  company_id bigint not null references public.companies (id) on delete restrict,
  branch_id bigint,
  role public.user_role_enum not null,
  commission_rate numeric(5,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_membership_branch_company foreign key (branch_id, company_id)
    references public.branches (id, company_id) on delete restrict,
  constraint uq_memberships_id_company unique (id, company_id),
  constraint ck_membership_commission_rate check (commission_rate between 0 and 100),
  constraint ck_membership_agent_commission check (role = 'AGENT' or commission_rate = 0),
  constraint ck_membership_scope check (
    role not in ('SUPER_ADMIN', 'COMPANY_MANAGER', 'PASSENGER') or branch_id is null
  )
);

create unique index uq_company_membership_scope
  on public.company_memberships (user_id, company_id, role, coalesce(branch_id, 0::bigint));

create table public.company_settings (
  id bigint generated always as identity primary key,
  company_id bigint not null unique references public.companies (id) on delete restrict,
  seat_hold_minutes integer not null default 10,
  boarding_close_minutes integer not null default 30,
  currency char(3) not null default 'MRU',
  timezone text not null default 'Africa/Nouakchott',
  default_language text not null default 'ar',
  support_phone text,
  support_whatsapp text,
  receipt_footer text,
  ticket_footer text,
  logo_print_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  whatsapp_enabled boolean not null default true,
  email_enabled boolean not null default false,
  trip_delay_notification boolean not null default true,
  payment_notification boolean not null default true,
  allow_cash_payment boolean not null default true,
  allow_online_payment boolean not null default true,
  cancellation_policy jsonb not null default '{}'::jsonb,
  ticket_template_settings jsonb not null default '{}'::jsonb,
  feature_flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_company_settings_seat_hold check (seat_hold_minutes between 1 and 1440),
  constraint ck_company_settings_boarding_close check (boarding_close_minutes between 0 and 1440),
  constraint ck_company_settings_currency check (currency ~ '^[A-Z]{3}$'),
  constraint ck_company_settings_language check (default_language in ('ar', 'fr')),
  constraint ck_company_settings_json_objects check (
    jsonb_typeof(cancellation_policy) = 'object'
    and jsonb_typeof(ticket_template_settings) = 'object'
    and jsonb_typeof(feature_flags) = 'object'
  )
);
