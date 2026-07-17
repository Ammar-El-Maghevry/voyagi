create index idx_memberships_user_active
  on public.company_memberships (user_id, company_id) where is_active;
create index idx_memberships_company on public.company_memberships (company_id);
create index idx_memberships_branch on public.company_memberships (branch_id, company_id)
  where branch_id is not null;
create index idx_branches_company on public.branches (company_id) where deleted_at is null;
create index idx_branches_city on public.branches (city_id);
create index idx_stations_city on public.stations (city_id) where deleted_at is null;
create index idx_buses_company on public.buses (company_id) where deleted_at is null;
create index idx_buses_seat_layout on public.buses (seat_layout_id);
create index idx_staff_company on public.staff_members (company_id) where deleted_at is null;
create index idx_routes_company on public.routes (company_id) where deleted_at is null;
create index idx_routes_origin on public.routes (origin_station_id);
create index idx_routes_destination on public.routes (destination_station_id);
create index idx_route_price_history_effective
  on public.route_price_history (route_id, effective_from desc);
create index idx_route_price_history_actor on public.route_price_history (changed_by_user_id)
  where changed_by_user_id is not null;
create index idx_trips_search
  on public.trips (company_id, departure_time, status) where is_active;
create index idx_trips_route_departure on public.trips (route_id, departure_time);
create index idx_trips_company on public.trips (company_id);
create index idx_trips_bus on public.trips (bus_id, departure_time);
create index idx_trips_driver on public.trips (driver_id) where driver_id is not null;
create index idx_trips_assistant on public.trips (assistant_id) where assistant_id is not null;
create index idx_trip_events_trip on public.trip_events (trip_id, event_time desc);
create index idx_trip_events_company on public.trip_events (company_id, event_time desc);
create index idx_trip_events_actor on public.trip_events (actor_user_id)
  where actor_user_id is not null;
create index idx_bookings_trip on public.bookings (trip_id, created_at desc);
create index idx_bookings_company on public.bookings (company_id, created_at desc);
create index idx_bookings_branch on public.bookings (branch_id, created_at desc)
  where branch_id is not null;
create index idx_bookings_booked_by on public.bookings (booked_by_user_id, created_at desc)
  where booked_by_user_id is not null;
create index idx_passengers_booking on public.passengers (booking_id);
create index idx_passengers_boarding_station on public.passengers (boarding_station_id)
  where boarding_station_id is not null;
create index idx_seat_reservations_booking on public.seat_reservations (booking_id);
create index idx_seat_reservations_trip on public.seat_reservations (trip_id);
create index idx_payments_booking on public.payments (booking_id, created_at desc);
create index idx_payments_confirmer on public.payments (confirmed_by_user_id)
  where confirmed_by_user_id is not null;
create index idx_commissions_company_status
  on public.agent_commission_transactions (company_id, status, earned_at desc);
create index idx_commissions_booking on public.agent_commission_transactions (booking_id);
create index idx_maintenance_bus_status
  on public.vehicle_maintenance_records (bus_id, status, started_at desc);
create index idx_maintenance_creator on public.vehicle_maintenance_records (created_by_user_id)
  where created_by_user_id is not null;
create index idx_audit_company_created on public.audit_logs (company_id, created_at desc);
create index idx_audit_actor on public.audit_logs (actor_user_id)
  where actor_user_id is not null;
create index idx_audit_request_id on public.audit_logs (request_id) where request_id is not null;
create index idx_audit_correlation_id
  on public.audit_logs (correlation_id) where correlation_id is not null;
