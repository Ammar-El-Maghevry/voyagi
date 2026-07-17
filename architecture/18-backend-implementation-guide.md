# Voyagi Backend Implementation Guide

**Status:** Proposed<br>
**Version:** 1.0<br>
**Applies to:** Voyagi Backend v1<br>
**Primary framework:** NestJS<br>
**Architecture reference:** `13-backend-architecture.md`<br>
**API reference:** `14-api-design-standards.md`<br>
**Coding reference:** `15-coding-standards.md`<br>
**Security reference:** `16-security-architecture.md`<br>
**Testing reference:** `17-testing-strategy.md`

---

## 1. Purpose

This document defines the official implementation sequence for the Voyagi backend.

It answers:

- where implementation starts;
- which phase comes next;
- which modules depend on others;
- what must be completed before moving forward;
- how each phase is reviewed;
- how each phase is tested;
- what “done” means.

This guide is intended for developers, reviewers, and coding agents.

It must be followed phase by phase. Large jumps, undocumented shortcuts, and premature business features are not allowed.

---

## 2. Implementation Principles

The backend must be implemented according to the following rules:

1. Foundation before business logic.
2. Authentication before tenant-scoped modules.
3. Tenant context before company data access.
4. Transport catalog before trips.
5. Trips before bookings.
6. Bookings before payments and tickets.
7. Critical workflows before reporting.
8. Tests and documentation are part of implementation.
9. Each phase must be independently reviewable.
10. No phase is considered complete while known failures remain.

---

## 3. Global Definition of Done

A phase is complete only when:

- implementation matches architecture documents;
- type checking passes;
- linting passes;
- unit tests pass;
- integration tests pass where applicable;
- critical E2E tests pass;
- Swagger reflects implemented endpoints;
- configuration examples are updated;
- no secrets are committed;
- no temporary debug code remains;
- no TODO blocks critical behavior;
- database access is tenant-safe;
- errors use stable codes;
- logs are structured and sanitized;
- documentation is updated;
- the change is reviewed before merge.

Recommended verification commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

Use the actual workspace commands defined in the repository.

---

## 4. Branch and Delivery Strategy

Each implementation phase should use a dedicated branch.

Examples:

```text
feature/backend-foundation
feature/authentication
feature/tenant-context
feature/company-management
feature/fleet-routes
feature/trips
feature/booking-engine
feature/payments
feature/tickets
```

Rules:

- one major phase per pull request;
- avoid mixing unrelated features;
- migrations must be included with the feature that requires them;
- review architecture compliance before merge;
- merge only after all checks pass;
- delete merged branches.

---

# Phase 0 — Repository Readiness

## Goal

Confirm that the monorepo is ready for backend implementation.

## Tasks

- review `11-monorepo-structure.md`;
- confirm `apps/api` location;
- confirm package manager;
- confirm root scripts;
- confirm Node.js version;
- confirm TypeScript configuration;
- confirm environment file conventions;
- confirm Docker development strategy;
- confirm Supabase local development commands.

## Expected structure

```text
apps/
  api/

packages/
  config/
  types/
  testing/

architecture/
supabase/
```

Shared packages should be created only when multiple applications genuinely need them.

## Deliverables

- documented Node.js version;
- documented package manager;
- root workspace scripts;
- `.env.example`;
- local setup instructions.

## Acceptance criteria

- repository installs from a clean checkout;
- workspace commands run successfully;
- no application business code is added yet.

---

# Phase 1 — NestJS Foundation

## Goal

Create a production-grade NestJS application without business modules.

## Tasks

### Application bootstrap

- create NestJS app in `apps/api`;
- enable graceful shutdown;
- configure global API prefix;
- configure API versioning;
- configure trusted proxy behavior if required;
- configure request body size limits.

### Configuration

- install and configure `ConfigModule`;
- define typed configuration objects;
- validate required environment variables at startup;
- fail fast when configuration is invalid.

Suggested configuration areas:

```text
app
database
auth
cors
logging
rateLimit
swagger
```

### Validation

- add global validation pipe;
- whitelist documented fields;
- reject invalid payloads;
- enable safe type transformation.

### Error handling

- add global exception filter;
- implement standard error envelope;
- map validation errors;
- generate stable request IDs;
- sanitize internal failures.

### Logging

- add structured logger;
- add request logging interceptor or middleware;
- include:
  - requestId;
  - route;
  - method;
  - status;
  - duration;
- redact credentials and tokens.

### API documentation

- configure Swagger;
- add version and environment metadata;
- protect or disable Swagger in production by configuration.

### Health

Implement:

```text
GET /api/v1/health/live
GET /api/v1/health/ready
```

### Security baseline

- enable Helmet or equivalent;
- configure explicit CORS;
- add rate-limiting foundation;
- disable unsafe defaults.

## Tests

- app bootstrap test;
- configuration validation tests;
- health E2E tests;
- validation error response test;
- unknown route test;
- request ID response test.

## Deliverables

- runnable API;
- Swagger documentation;
- health endpoints;
- global validation;
- global errors;
- structured logs;
- initial security middleware.

## Acceptance criteria

```text
GET /api/v1/health/live → 200
GET /api/v1/health/ready → 200 when database is available
```

- application starts with valid configuration;
- application fails safely with invalid configuration;
- no business modules exist yet.

---

# Phase 2 — Database Infrastructure

## Goal

Create the approved PostgreSQL access layer and transaction foundation.

## Tasks

- configure remote and local database connections;
- create database module;
- implement connection lifecycle;
- implement transaction manager;
- define repository transaction context;
- add database health indicator;
- add safe query logging for development;
- ensure SQL parameters are always bound.

## Repository rules

Repositories must:

- live inside their owning modules;
- receive tenant identifiers explicitly for tenant-owned data;
- select explicit columns;
- avoid raw database objects outside infrastructure;
- support transaction context;
- convert known constraint failures into typed errors.

## Tests

- connection test;
- rollback test;
- commit test;
- unique-constraint error mapping test;
- database readiness test.

## Deliverables

- database module;
- transaction abstraction;
- integration test database setup;
- repository testing helpers.

## Acceptance criteria

- one integration test writes and rolls back data;
- health readiness reflects database connectivity;
- no controller accesses the database directly.

---

# Phase 3 — Authentication

## Goal

Verify Supabase access tokens and resolve authenticated users.

## Tasks

- implement bearer token extraction;
- validate Supabase JWT signature;
- validate issuer;
- validate audience;
- validate expiry;
- extract authenticated user ID;
- resolve profile;
- define authenticated principal type;
- add public-route decorator;
- secure endpoints by default.

## Initial endpoint

```text
GET /api/v1/auth/me
```

Recommended response:

```json
{
  "success": true,
  "data": {
    "userId": "...",
    "profile": {}
  },
  "requestId": "..."
}
```

## Errors

```text
UNAUTHENTICATED
TOKEN_EXPIRED
TOKEN_INVALID
PROFILE_NOT_FOUND
```

## Tests

- missing token;
- malformed token;
- expired token;
- invalid issuer;
- invalid audience;
- valid token;
- profile resolution.

## Deliverables

- authentication guard;
- current user decorator;
- JWT verification adapter;
- `/auth/me`.

## Acceptance criteria

- protected routes reject unauthenticated requests;
- valid Supabase users are resolved correctly;
- authorization logic does not trust client user IDs.

---

# Phase 4 — Tenant Context and Authorization

## Goal

Implement secure multi-tenant request context.

## Tasks

- resolve company context;
- validate active membership;
- load role;
- resolve permissions;
- create request context;
- add tenant decorator;
- add permission decorator;
- add permission guard;
- prevent cross-company resource access.

## Recommended request context

```ts
type RequestContext = {
  requestId: string;
  userId: string;
  profileId: string;
  companyId?: string;
  membershipId?: string;
  role?: string;
  permissions: string[];
};
```

## Initial permissions

Define the permission catalog centrally.

Examples:

```text
companies.read
companies.update
memberships.read
memberships.manage
branches.read
branches.manage
staff.read
staff.manage
fleet.read
fleet.manage
routes.read
routes.manage
trips.read
trips.manage
bookings.read
bookings.create
bookings.cancel
payments.read
payments.confirm
payments.refund
tickets.read
tickets.issue
tickets.validate
maintenance.read
maintenance.manage
audit.read
```

## Tests

- active membership accepted;
- inactive membership rejected;
- wrong company rejected;
- missing permission rejected;
- role permissions loaded;
- RLS blocks unauthorized direct access.

## Deliverables

- tenant context resolver;
- company access guard;
- permission guard;
- reusable decorators;
- cross-tenant E2E suite.

## Acceptance criteria

- no tenant-scoped endpoint works without verified membership;
- tenant context is backend-generated;
- cross-tenant access fails at API and database layers.

---

# Phase 5 — Profiles, Companies, Memberships, and Settings

## Goal

Implement the first tenant-management modules.

## Modules

```text
profiles
companies
memberships
company-settings
```

## Suggested endpoints

```text
GET /api/v1/profiles/me

GET /api/v1/companies
GET /api/v1/companies/{companyId}
PATCH /api/v1/companies/{companyId}

GET /api/v1/companies/{companyId}/memberships
POST /api/v1/companies/{companyId}/memberships
PATCH /api/v1/company-memberships/{membershipId}
```

## Business rules

- users only see permitted companies;
- membership changes require explicit permission;
- dangerous self-demotion rules must be reviewed;
- last owner/admin protections should be considered;
- company setting changes are audited;
- membership activity status is respected.

## Tests

- company listing scope;
- company update permission;
- membership creation;
- duplicate membership conflict;
- inactive membership behavior;
- cross-tenant membership access.

## Acceptance criteria

- company administration is safe;
- membership changes create audit records;
- no company data leaks between tenants.

---

# Phase 6 — Branches and Staff

## Goal

Implement operational organization inside companies.

## Modules

```text
branches
staff-members
```

## Suggested endpoints

```text
GET /api/v1/branches
POST /api/v1/branches
GET /api/v1/branches/{branchId}
PATCH /api/v1/branches/{branchId}

GET /api/v1/staff-members
POST /api/v1/staff-members
GET /api/v1/staff-members/{staffMemberId}
PATCH /api/v1/staff-members/{staffMemberId}
```

## Business rules

- branches belong to exactly one company;
- staff members are tenant-scoped;
- inactive staff cannot perform restricted operations;
- branch access rules must be explicit;
- staff changes are audited.

## Tests

- branch CRUD permissions;
- staff creation;
- branch ownership;
- inactive staff behavior;
- cross-company rejection.

## Acceptance criteria

- branch and staff operations respect tenant and permission boundaries;
- no generic CRUD service bypasses business rules.

---

# Phase 7 — Cities, Stations, Fleet, and Seat Layouts

## Goal

Implement transport catalog and fleet foundations.

## Modules

```text
cities
stations
buses
seat-layouts
maintenance
```

## Suggested endpoints

```text
GET /api/v1/cities
GET /api/v1/stations
POST /api/v1/stations

GET /api/v1/buses
POST /api/v1/buses
GET /api/v1/buses/{busId}
PATCH /api/v1/buses/{busId}

GET /api/v1/seat-layouts
POST /api/v1/seat-layouts
```

## Business rules

- stations are associated with cities;
- tenant-owned stations are scoped correctly;
- buses belong to one company;
- seat layouts are validated;
- capacity matches seat configuration;
- maintenance state may restrict bus assignment;
- odometer changes must be consistent.

## Tests

- invalid seat layout;
- bus ownership;
- capacity mismatch;
- maintenance restrictions;
- duplicate fleet identifiers;
- pagination and filters.

## Acceptance criteria

- a valid bus and seat layout can be created;
- invalid layouts are rejected;
- fleet queries are tenant-scoped.

---

# Phase 8 — Routes and Route Pricing

## Goal

Implement route definitions and historical pricing.

## Modules

```text
routes
route-prices
```

## Suggested endpoints

```text
GET /api/v1/routes
POST /api/v1/routes
GET /api/v1/routes/{routeId}
PATCH /api/v1/routes/{routeId}

GET /api/v1/routes/{routeId}/price-history
POST /api/v1/routes/{routeId}/prices
```

## Business rules

- origin and destination must differ;
- route belongs to one company;
- prices require currency;
- price changes create immutable history;
- old bookings retain price snapshots;
- distance must be valid when supplied.

## Tests

- invalid route endpoints;
- route ownership;
- price history append-only behavior;
- unauthorized price changes;
- currency validation.

## Acceptance criteria

- route and price history workflows are complete;
- changing route prices does not alter historical booking prices.

---

# Phase 9 — Trips

## Goal

Implement trip scheduling and operational lifecycle.

## Modules

```text
trips
trip-events
```

## Suggested endpoints

```text
GET /api/v1/trips
POST /api/v1/trips
GET /api/v1/trips/{tripId}
PATCH /api/v1/trips/{tripId}

POST /api/v1/trips/{tripId}/start
POST /api/v1/trips/{tripId}/complete
POST /api/v1/trips/{tripId}/cancel

GET /api/v1/trips/{tripId}/events
GET /api/v1/trips/{tripId}/seats
```

## Business rules

- assigned bus belongs to the company;
- route belongs to the company;
- scheduled times are valid;
- bus scheduling conflicts are prevented;
- maintenance restrictions are respected;
- state transitions follow documented rules;
- actual departure and arrival times are server-controlled;
- trip events are append-only.

## Tests

- valid trip creation;
- conflicting bus assignment;
- invalid state transitions;
- start/complete timestamps;
- cancellation rules;
- event immutability;
- tenant isolation.

## Acceptance criteria

- trips can be scheduled and operated safely;
- invalid transitions return stable business errors;
- trip seat availability can be queried.

---

# Phase 10 — Passenger and Availability Foundation

## Goal

Prepare passenger management and booking availability queries.

## Modules

```text
passengers
availability
```

## Suggested endpoints

```text
GET /api/v1/trips/search
GET /api/v1/trips/{tripId}/availability
GET /api/v1/passengers
POST /api/v1/passengers
```

## Business rules

- public trip search reveals only approved information;
- passenger information is protected;
- tenant agents access only authorized passenger records;
- availability is calculated from authoritative seat state;
- price estimates are marked as estimates until booking.

## Tests

- public trip search;
- tenant trip search;
- availability accuracy;
- passenger data access restrictions;
- pagination and sorting.

## Acceptance criteria

- clients can search trips;
- seat availability is accurate;
- passenger data is not overexposed.

---

# Phase 11 — Booking Engine

## Goal

Implement the central booking workflow.

## Required use cases

```text
CreatePassengerBookingUseCase
CreateAgentBookingUseCase
GetBookingUseCase
ListBookingsUseCase
CancelBookingUseCase
ExpireBookingUseCase
```

## Suggested endpoints

```text
POST /api/v1/bookings
GET /api/v1/bookings
GET /api/v1/bookings/{bookingId}
POST /api/v1/bookings/{bookingId}/cancel
GET /api/v1/bookings/{bookingId}/events
```

## Creation workflow

1. authenticate actor when required;
2. resolve tenant context;
3. validate idempotency key;
4. load trip;
5. validate booking window;
6. validate seat requests;
7. calculate server-authoritative price;
8. create or link passengers;
9. create booking;
10. reserve seats in the same transaction;
11. create booking events;
12. commit;
13. return stable response.

## Mandatory safeguards

- transaction required;
- database seat conflict handling;
- idempotency required;
- no partial booking;
- price snapshot required;
- booking source required;
- tenant-aware references;
- optimistic locking where applicable.

## Errors

```text
TRIP_NOT_BOOKABLE
SEAT_ALREADY_RESERVED
INVALID_SEAT_SELECTION
BOOKING_ALREADY_EXISTS
BOOKING_NOT_CANCELLABLE
IDEMPOTENCY_CONFLICT
PRICE_CHANGED
```

## Tests

### Unit

- pricing rules;
- cancellation policy;
- state transitions;
- idempotency behavior.

### Integration

- concurrent seat booking;
- transaction rollback;
- unique seat conflict;
- booking event append;
- price snapshot persistence.

### E2E

- passenger booking;
- agent booking;
- repeated idempotent request;
- conflicting seat request;
- cancellation;
- cross-company booking access.

## Acceptance criteria

- concurrent attempts cannot double-book a seat;
- duplicate retries return the original result;
- failures leave no partial data;
- documented passenger and agent sequences are satisfied.

---

# Phase 12 — Payments

## Goal

Implement payment lifecycle behind provider-neutral interfaces.

## Required use cases

```text
CreatePaymentUseCase
ConfirmPaymentUseCase
HandlePaymentWebhookUseCase
RefundPaymentUseCase
GetPaymentUseCase
```

## Suggested endpoints

```text
POST /api/v1/payments
GET /api/v1/payments/{paymentId}
POST /api/v1/payments/{paymentId}/confirm
POST /api/v1/payments/{paymentId}/refund
POST /api/v1/webhooks/payments/{provider}
```

## Tasks

- define `PaymentProvider` interface;
- implement test provider first;
- implement signature verification abstraction;
- map provider status to internal status;
- persist provider event identifiers;
- implement webhook idempotency;
- implement refund records;
- protect immutable financial history.

## Tests

- payment creation;
- duplicate confirmation;
- invalid transition;
- valid webhook;
- invalid signature;
- duplicate webhook;
- refund;
- partial provider failure;
- transaction consistency.

## Acceptance criteria

- duplicate provider events do not duplicate money records;
- confirmed financial data is immutable;
- provider details do not leak into domain code.

---

# Phase 13 — Tickets

## Goal

Issue and validate secure tickets.

## Required use cases

```text
IssueTicketUseCase
GetTicketUseCase
VerifyTicketUseCase
ValidateTicketUseCase
RevokeTicketUseCase
```

## Suggested endpoints

```text
POST /api/v1/bookings/{bookingId}/tickets
GET /api/v1/tickets/{ticketId}
POST /api/v1/tickets/verify
POST /api/v1/tickets/{ticketId}/validate
```

## Business rules

- ticket issuance requires valid booking/payment state;
- QR does not contain sensitive business data;
- stored QR material follows hash rules;
- validation is server-authoritative;
- duplicate scans are handled safely;
- refunded, cancelled, or revoked tickets fail validation;
- successful boarding creates an audit/event record.

## Tests

- valid issuance;
- issuance before payment rejected;
- duplicate issuance idempotency;
- valid verification;
- invalid QR;
- revoked ticket;
- duplicate scan;
- tenant/operator permissions.

## Acceptance criteria

- ticket lifecycle is secure and auditable;
- QR secrets are not exposed;
- repeated requests are safe.

---

# Phase 14 — Maintenance and Agent Commissions

## Goal

Complete remaining operational and financial support modules.

## Modules

```text
maintenance
commissions
```

## Suggested endpoints

```text
GET /api/v1/maintenance-records
POST /api/v1/maintenance-records
PATCH /api/v1/maintenance-records/{recordId}

GET /api/v1/agent-commission-transactions
```

## Business rules

- maintenance records belong to tenant buses;
- completed records are audited;
- commission transactions are append-only;
- corrections use compensating entries;
- only authorized users may access commission data.

## Tests

- maintenance lifecycle;
- bus ownership;
- commission calculation;
- immutable commission history;
- cross-tenant access.

## Acceptance criteria

- operational maintenance is traceable;
- commission history cannot be silently rewritten.

---

# Phase 15 — Audit and Operational Observability

## Goal

Expose safe audit capabilities and complete production observability.

## Tasks

- standardize audit event writer;
- include actor, company, action, resource, request context;
- add safe audit query endpoint;
- add production logging configuration;
- add slow-request logging;
- add dependency health checks;
- prepare metrics hooks;
- prepare error monitoring integration.

## Suggested endpoint

```text
GET /api/v1/audit-logs
```

## Rules

- audit logs are append-only;
- access requires explicit permission;
- sensitive values are redacted;
- audit queries are paginated;
- query scope is tenant-safe;
- raw system internals are not exposed.

## Tests

- audit record creation;
- immutability;
- permission enforcement;
- tenant scoping;
- pagination.

## Acceptance criteria

- critical actions produce audit entries;
- production failures can be traced by request ID.

---

# Phase 16 — API Hardening

## Goal

Apply consistent platform-wide API protections.

## Tasks

- review all public endpoints;
- review permission matrix;
- tune rate limits;
- validate CORS allowlist;
- enforce payload limits;
- review OpenAPI exposure;
- verify error sanitization;
- verify PII redaction;
- review dependency timeouts;
- add retry policies where appropriate;
- review cache headers;
- test malformed inputs;
- test abuse scenarios.

## Security tests

- authentication bypass attempts;
- cross-tenant ID swapping;
- mass assignment;
- SQL injection inputs;
- oversized payloads;
- rate-limit enforcement;
- webhook replay;
- invalid JWT claims;
- unauthorized audit access.

## Acceptance criteria

- no known high-severity security findings;
- all sensitive endpoints have explicit policies;
- API behavior matches security architecture.

---

# Phase 17 — Complete Testing and Quality Gate

## Goal

Establish the final automated quality gate.

## Tasks

- complete unit coverage for business rules;
- complete integration coverage for repositories and RLS;
- complete E2E coverage for critical journeys;
- add architecture boundary tests;
- add migration validation;
- add concurrency tests;
- add test data factories;
- add deterministic database cleanup;
- add CI pipeline.

## Critical E2E journeys

1. User authentication.
2. Tenant selection.
3. Company management.
4. Fleet and route setup.
5. Trip creation.
6. Passenger booking.
7. Agent booking.
8. Seat conflict.
9. Payment confirmation.
10. Ticket issuance.
11. Ticket validation.
12. Booking cancellation.
13. Refund.
14. Cross-tenant denial.

## CI quality gate

The pull request must fail when any of these fail:

```text
format check
lint
type check
unit tests
integration tests
E2E tests
build
migration checks
secret scanning
dependency audit
```

## Acceptance criteria

- all critical journeys pass automatically;
- CI blocks broken code;
- tests are deterministic.

---

# Phase 18 — Deployment Readiness

## Goal

Prepare the backend for the first production deployment.

## Tasks

- production Docker image;
- multi-stage build;
- non-root runtime user;
- environment validation;
- graceful shutdown;
- health probes;
- migration execution plan;
- rollback plan;
- deployment documentation;
- secret management;
- log destination;
- monitoring;
- backup verification;
- recovery procedure;
- staging deployment;
- smoke tests.

## Required deployment sequence

1. build immutable artifact;
2. run automated tests;
3. deploy to staging;
4. apply migrations safely;
5. run staging smoke tests;
6. review logs and health;
7. approve production release;
8. apply production migrations;
9. deploy application;
10. run production smoke tests;
11. monitor errors and latency.

## Acceptance criteria

- staging deployment succeeds;
- rollback process is documented and tested;
- production secrets are external;
- health checks work;
- migrations are synchronized;
- smoke tests pass.

---

# Phase 19 — Post-Launch Stabilization

## Goal

Stabilize the first production release before adding major features.

## Tasks

- monitor errors;
- monitor slow queries;
- review booking conflicts;
- review payment reconciliation;
- review ticket scan failures;
- review audit completeness;
- fix production issues with regression tests;
- tune indexes based on real traffic;
- tune rate limits;
- update documentation.

## Rules

Do not immediately start major feature expansion before:

- critical production workflows are stable;
- reconciliation is reliable;
- monitoring is useful;
- backup and recovery are verified.

---

## 5. Dependency Map

Recommended dependency order:

```text
Foundation
   ↓
Database Infrastructure
   ↓
Authentication
   ↓
Tenant Context and Authorization
   ↓
Companies / Memberships
   ↓
Branches / Staff
   ↓
Cities / Stations / Fleet
   ↓
Routes / Pricing
   ↓
Trips
   ↓
Passengers / Availability
   ↓
Bookings
   ↓
Payments
   ↓
Tickets
   ↓
Maintenance / Commissions
   ↓
Audit / Hardening
   ↓
Deployment
```

A later phase must not be implemented by duplicating responsibilities from an unfinished earlier phase.

---

## 6. Coding-Agent Execution Protocol

When assigning a phase to Codex/OpenCode, the prompt should require the agent to:

1. read all relevant architecture documents;
2. inspect current repository state;
3. implement only the requested phase;
4. avoid redesigning approved architecture;
5. avoid unrelated refactoring;
6. add or update tests;
7. update Swagger;
8. update documentation;
9. run verification commands;
10. provide a clear change report;
11. list any uncertainty or deviation;
12. stop before deployment unless explicitly authorized.

Recommended agent report format:

```text
Summary
Files changed
Architecture compliance
Tests added
Commands executed
Results
Known limitations
Recommended next step
```

---

## 7. Phase Review Checklist

Before accepting any phase, review:

### Architecture

- does implementation follow module boundaries?
- are dependencies inward?
- is business logic outside controllers?
- are repositories scoped correctly?
- are transactions placed correctly?

### Security

- is authentication enforced?
- are permissions explicit?
- is tenant isolation enforced?
- are errors sanitized?
- are secrets protected?

### API

- do routes follow standards?
- are response envelopes consistent?
- are error codes stable?
- is pagination present?
- is idempotency present where needed?
- is Swagger accurate?

### Database

- are queries parameterized?
- are constraints respected?
- are migrations additive?
- are historical records immutable?
- are tenant queries scoped?

### Testing

- are important success paths tested?
- are important failure paths tested?
- are concurrency risks tested?
- are cross-tenant tests present?
- does the full suite pass?

---

## 8. First Implementation Assignment

The first coding task after approving this guide must be:

> Implement Phase 1 — NestJS Foundation only.

The agent must not implement:

- authentication;
- companies;
- bookings;
- payments;
- tickets;
- business repositories;
- business database queries.

Expected result:

```text
NestJS app starts
Configuration is validated
Global validation works
Global error format works
Structured request logging works
Swagger works
Health endpoints work
Foundation tests pass
```

This creates a clean and reviewable starting point before business implementation.

---

## 9. Final Implementation Contract

Voyagi backend implementation must proceed incrementally.

The following are mandatory:

1. Do not skip foundation phases.
2. Do not mix multiple major phases in one change.
3. Do not place business logic in controllers.
4. Do not bypass tenant authorization.
5. Do not bypass database constraints.
6. Do not write consistency-critical workflows without transactions.
7. Do not implement retryable financial or booking operations without idempotency.
8. Do not merge without tests and documentation.
9. Do not deploy before staging verification.
10. Do not change approved architecture silently.

Any deviation must be documented and approved through an Architecture Decision Record.
