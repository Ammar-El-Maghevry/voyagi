# Database Review

## Architecture Resolution

The implementation follows `12-business-rules.md` first, then the ERD and state diagrams, as required by the database task.

| Conflict or ambiguity | Resolution |
|---|---|
| Booking sequences insert a seat reservation before its required booking exists. | The transaction inserts the booking first, then passengers and seat reservations. The partial unique index still resolves concurrent seat claims atomically. |
| Passenger sequence checks trip status `OPEN`, but `trip_status_enum` has no `OPEN`. | Booking code must treat the documented schedulable states (`SCHEDULED` and, where policy permits, `BOARDING`) as open and enforce `boarding_closes_at`. No undocumented enum was added. |
| Business rules require a frozen cancellation policy but the ERD omits its destination column. | `bookings.cancellation_policy_snapshot` was added as a required JSON object. |
| Some text calls the booking expiry `held_until`, while the ERD places `held_until` on seats and `expires_at` on bookings. | `bookings.expires_at` is the booking-level snapshot; each held seat stores `held_until`. The backend writes both from the same setting in one transaction. |
| The ERD's nullable membership uniqueness would allow duplicate rows because PostgreSQL treats NULLs as distinct. | A unique expression index normalizes a NULL branch to zero, making company-wide memberships idempotent. |
| `SUPER_ADMIN` is global but memberships are company-owned. | Super-admin authorization comes from trusted JWT `app_metadata.role`; company memberships remain tenant-scoped. |

## Design Review

- Tenant consistency is enforced with composite foreign keys, not only application checks.
- Seat availability is virtual. The active-seat partial unique index is the final concurrency boundary and does not depend on Redis.
- Payment attempts remain one-to-many per booking. Failed attempts are preserved; uniqueness applies to internal references, non-null provider references, and the single successful/refunded attempt per booking.
- Commission rows are a separate ledger and are unique per agent membership and booking. Paid commission reversals require a future settlement record rather than mutation or deletion.
- Trip and audit timelines are append-only through triggers and permissions.
- Maintenance scheduling overlap and bus status synchronization remain one NestJS transaction, as the business rules explicitly reject a complex MVP trigger.
- State-transition authorization remains in NestJS. PostgreSQL constrains valid enum values, relationships, snapshots, amounts, and terminal history without duplicating the application state machine.

## Migration Review

| Migration | Review result |
|---|---|
| `001_extensions` | Runtime extensions are idempotent and schema-scoped; no test extension is removed. |
| `002_enums` | All 14 enums exactly match the ERD and state machines. |
| `003_profiles_locations` | Auth ownership, location constraints, coordinates, UUID/BIGINT, and timestamps comply. |
| `004_companies` | Branch and membership tenant scope, nullable-branch uniqueness, settings defaults, and JSON object checks comply. |
| `005_fleet_routes` | Fleet ownership, route station checks, money types, canonical seat layouts, and non-overlapping price periods comply. |
| `006_trips` | Composite route/bus/staff tenant keys, schedule checks, snapshots, and append-only event ownership comply. |
| `007_bookings` | Trip/branch tenant keys, amount equation, policy snapshot, passenger ownership, canonical seat validation, and active-seat uniqueness comply. |
| `008_financials_tickets` | Attempt identity, single successful payment, ticket passenger-seat identity, commission source, money, and immutable references comply. |
| `009_maintenance_audit` | Bus tenant ownership, maintenance checks, trace IDs, and immutable audit actor references comply. |
| `010_indexes` | Search, timeline, tenant, partial uniqueness, audit, and foreign-key access paths are covered without exact duplicate indexes. |
| `011_triggers` | Required `updated_at`, auth profile, company settings, seat layout, staff, payment, commission, append-only, and no-delete triggers comply. |
| `012_rls` | All public tables have RLS; grants are read-only by default and policies enforce ownership, branch, company, manager, and global-admin scopes. |
| `013_production_hardening` | Adds validated contacts, currency coverage, operational analytics, immutable booking events, price snapshots, and optimistic-lock versions without replacing existing fields. |

## Security Review

- No anonymous table privileges are granted.
- Authenticated table access is select-only except self-service profile fields.
- Company and branch filters are implemented in security-definer helper functions with empty search paths to avoid recursive RLS and object-shadowing attacks.
- Bookings, seats, payments, tickets, commissions, trip events, and audit logs cannot be written directly by clients.
- Booking events follow the same backend-only write boundary and booking ownership policy as the rest of the booking aggregate.
- Ticket rows contain only hashed QR material; no raw bearer token column exists.

## Performance Review

- Trip search, route departures, active seats, booking ownership, payment attempts, company/branch scope, event timelines, maintenance, commission, and audit lookup paths have targeted indexes.
- Referencing columns used for joins and delete-integrity checks have full or implication-compatible indexes; partial indexes are reserved for active/nullable query predicates.
- Exact catalog comparison found no duplicate index definitions.
- JSONB is limited to flexible layouts, policy/configuration documents, event metadata, and audit snapshots; relational identities and lifecycle states remain typed columns.

## Remaining Risks

- NestJS must enforce state-transition authorization, signed webhook verification, booking transaction ordering, maintenance-window overlap, and scheduled hold release. PostgreSQL remains the final constraint boundary for identities and uniqueness.
- The Phase 1 ERD does not model refund amount/reference history or paid-commission clawback settlements. Those require separately reviewed future ledger changes; audit rows are not a financial substitute.
- Seat layout JSON has a deliberately narrow documented shape. Any richer visual grid should remain presentation metadata while preserving its canonical `seat_numbers` array.
- Global super-admin access trusts server-issued JWT `app_metadata.role`; token issuance and key protection remain deployment responsibilities.

## Verification

`supabase/tests/database/initial_database.test.sql` contains 45 assertions covering active-seat exclusion and reuse, layout membership, tenant foreign keys, booking idempotency, payment uniqueness and terminal evidence, ticket-seat identity, commission eligibility and uniqueness, production-hardening defaults and checks, immutable trip/booking events, company/branch RLS (including booking-event and unassigned-booking isolation), universal RLS enablement, and direct-client write denial. Reset and lint results are recorded in the implementation handoff, not in this durable design document.
