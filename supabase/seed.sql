insert into public.cities (name_ar, name_fr)
values
  ('نواكشوط', 'Nouakchott'),
  ('نواذيبو', 'Nouadhibou'),
  ('روصو', 'Rosso'),
  ('أطار', 'Atar');

insert into public.stations (city_id, name_ar, name_fr, latitude, longitude)
select city.id, seed.name_ar, seed.name_fr, seed.latitude, seed.longitude
from (
  values
    ('Nouakchott', 'محطة نواكشوط المركزية', 'Gare centrale de Nouakchott', 18.0735::numeric, -15.9582::numeric),
    ('Nouadhibou', 'محطة نواذيبو المركزية', 'Gare centrale de Nouadhibou', 20.9425::numeric, -17.0362::numeric),
    ('Rosso', 'محطة روصو المركزية', 'Gare centrale de Rosso', 16.5138::numeric, -15.8050::numeric),
    ('Atar', 'محطة أطار المركزية', 'Gare centrale d''Atar', 20.5169::numeric, -13.0499::numeric)
) as seed(city_name, name_ar, name_fr, latitude, longitude)
join public.cities city on city.name_fr = seed.city_name;

insert into public.companies (name, contact_phone)
values ('Voyagi Demo Transport', '+22200000000');

insert into public.branches (company_id, city_id, name_ar, name_fr, phone)
select company.id, city.id, 'الفرع المركزي', 'Agence centrale', '+22200000000'
from public.companies company
join public.cities city on city.name_fr = 'Nouakchott'
where company.name = 'Voyagi Demo Transport';

insert into public.seat_layouts (name, total_seats, layout_grid)
values (
  'Demo 2+2 / 40 seats',
  40,
  jsonb_build_object('columns', 4, 'aisle_after', 2, 'seat_numbers', to_jsonb(array(
    select value::text from generate_series(1, 40) value
  )))
);

insert into public.buses (company_id, seat_layout_id, plate_number, bus_model)
select company.id, layout.id, 'DEMO-001', 'Demo Coach'
from public.companies company
cross join public.seat_layouts layout
where company.name = 'Voyagi Demo Transport'
  and layout.name = 'Demo 2+2 / 40 seats';

insert into public.routes (
  company_id, origin_station_id, destination_station_id,
  default_price_mru, estimated_duration_minutes
)
select company.id, origin.id, destination.id, 500.00, 300
from public.companies company
cross join public.stations origin
cross join public.stations destination
where company.name = 'Voyagi Demo Transport'
  and origin.name_fr = 'Gare centrale de Nouakchott'
  and destination.name_fr = 'Gare centrale de Nouadhibou';

insert into public.route_price_history (route_id, price_mru, change_reason)
select id, default_price_mru, 'Initial seed price'
from public.routes;
