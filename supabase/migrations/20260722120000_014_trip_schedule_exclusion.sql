-- Phase 9 (Trips): prevent one bus from being assigned to two overlapping trips.
--
-- Business rule (18-backend-implementation-guide.md, Phase 9): "bus scheduling
-- conflicts are prevented." The schema up to migration 013 has indexes on
-- (bus_id, departure_time) but no constraint enforcing non-overlap, so an
-- application-only check-then-insert would race under concurrency. This adds a
-- concurrency-safe gist EXCLUDE constraint, mirroring the existing
-- `ex_route_price_periods` on route_price_history. `btree_gist` (enabled in
-- migration 001) provides the equality operator class for the bigint bus_id.
--
-- Scope: only *live operational* trips occupy their bus. The partial predicate
-- `is_active AND status <> 'CANCELLED'` means:
--   • SCHEDULED / ONGOING / COMPLETED (all is_active) block overlaps;
--   • a CANCELLED trip frees its window (it never ran);
--   • a soft-removed trip (is_active = false — trips have no deleted_at column,
--     so is_active is their removal flag, matching idx_trips_search) frees its
--     window too.
-- Only documented `trip_status_enum` values are referenced (no invented status).
-- The window is the half-open range [departure_time, estimated_arrival_time) so
-- back-to-back trips (arrival == next departure) do not conflict.
--
-- Forward-only; the seed inserts no trips, and production trip data does not yet
-- exist (Phase 9 is the first phase to create trips).

alter table public.trips
  add constraint ex_trips_bus_no_overlap
  exclude using gist (
    bus_id with =,
    tstzrange(departure_time, estimated_arrival_time, '[)') with &&
  )
  where (is_active and status <> 'CANCELLED'::public.trip_status_enum);
