# Voyagi Backend Architecture

**Status:** Proposed<br>
**Version:** 1.0<br>
**Target:** Voyagi Backend v1<br>
**Primary framework:** NestJS<br>
**Database:** PostgreSQL on Supabase<br>
**Architecture style:** Modular Monolith with pragmatic Clean Architecture<br>
**Tenancy model:** Multi-tenant SaaS

---

## 1. Purpose

This document defines the official backend architecture for Voyagi.

It is the implementation contract for the backend and must be followed by developers, code-generation agents, reviewers, and future contributors.

The goal is to build a backend that is:

- secure by default;
- multi-tenant by design;
- easy to test;
- easy to extend;
- observable in production;
- suitable for web, mobile, and third-party clients;
- able to evolve without a full rewrite.

This document complements the existing architecture documents and does not replace them.

Related documents:

- `01-system-context.md`
- `02-container-architecture.md`
- `03-backend-modules.md`
- `04-database-erd.md`
- `05-passenger-booking-sequence.md`
- `06-agent-booking-sequence.md`
- `07-seat-state-machine.md`
- `08-booking-state-machine.md`
- `09-payment-state-machine.md`
- `10-deployment.md`
- `11-monorepo-structure.md`
- `12-business-rules.md`
- `DATABASE_CONVENTIONS.md`
- `DATABASE_REVIEW.md`

---

## 2. Product Goal

Voyagi is a multi-tenant SaaS platform for intercity bus transportation companies.

The backend must support:

- passenger booking;
- agent-assisted booking;
- company and branch management;
- fleet management;
- route and trip planning;
- seat availability and reservations;
- payments and refunds;
- ticket issuance and validation;
- maintenance records;
- auditability;
- reporting;
- future mobile and web applications;
- future external integrations.

The architecture must support the first production release without adding unnecessary complexity, while preserving a clear path for future growth.

---

## 3. Architectural Principles

### 3.1 Modular monolith first

The first production version will be implemented as a modular monolith.

All business modules run in one deployable NestJS application, but module boundaries must remain explicit.

Reasons:

- faster development;
- simpler deployment;
- easier transactions;
- lower operational cost;
- simpler debugging;
- suitable for the current team size.

A module may later be extracted into a separate service only when there is a proven operational or scaling need.

### 3.2 Pragmatic Clean Architecture

Voyagi uses Clean Architecture principles without excessive abstraction.

The main layers are:

1. **Presentation**
2. **Application**
3. **Domain**
4. **Infrastructure**

Dependencies must point inward.

```text
Presentation
    ↓
Application
    ↓
Domain

Infrastructure implements ports required by Application and Domain.
```

The domain must not depend directly on NestJS, PostgreSQL, Supabase, HTTP, or external providers.

### 3.3 Database as a consistency boundary

PostgreSQL is the final source of truth.

The backend must respect and use the database protections already implemented:

- foreign keys;
- unique constraints;
- check constraints;
- RLS;
- immutable financial records;
- append-only event tables;
- optimistic locking columns;
- transaction-safe seat constraints.

Application validation improves user feedback, but it must not replace database guarantees.

### 3.4 Security by default

Every endpoint is considered protected unless explicitly marked public.

Every tenant-scoped operation must verify:

- authenticated identity;
- active company membership;
- role or permission;
- tenant ownership of all referenced resources.

Client-provided tenant identifiers are never trusted without authorization checks.

### 3.5 Explicit business workflows

Complex operations must be implemented as use cases, not as generic CRUD services.

Examples:

- create passenger booking;
- create agent booking;
- reserve seats;
- confirm payment;
- issue ticket;
- cancel booking;
- refund payment;
- start trip;
- complete trip;
- validate ticket.

### 3.6 Idempotency for retryable writes

Operations that may be retried by clients or external providers must support idempotency.

Examples:

- booking creation;
- payment confirmation;
- refund requests;
- webhook processing;
- ticket issuance.

### 3.7 Observability is part of the architecture

Production code must produce useful:

- structured logs;
- request correlation IDs;
- audit records;
- health checks;
- metrics-ready events;
- sanitized error reports.

---

## 4. High-Level Backend Context

```text
Web Admin
Passenger App
Agent App
Driver App
External Integrations
        │
        ▼
   REST API / Webhooks
        │
        ▼
      NestJS
        │
        ├── Authentication
        ├── Authorization
        ├── Tenant Context
        ├── Business Modules
        ├── Background Jobs
        └── Integration Adapters
        │
        ▼
 PostgreSQL / Supabase
```

The backend owns business behavior and coordinates database transactions.

Frontend applications must not implement authoritative booking, payment, ticket, or seat-allocation rules.

---

## 5. Technology Decisions

### 5.1 Backend framework

Use NestJS with TypeScript.

Required capabilities:

- modules;
- dependency injection;
- guards;
- interceptors;
- pipes;
- exception filters;
- OpenAPI support;
- testing utilities;
- lifecycle hooks.

### 5.2 Database access

Use a thin, explicit PostgreSQL data-access layer.

The implementation may use a PostgreSQL client or a lightweight query builder, but it must preserve:

- SQL visibility;
- transaction control;
- database-native constraints;
- compatibility with Supabase;
- predictable performance;
- explicit tenant filtering.

Do not introduce a heavy ORM that hides important SQL behavior unless an ADR explicitly approves it.

### 5.3 Authentication

Supabase Auth is the identity provider.

The API verifies access tokens and maps authenticated users to:

- `profiles`;
- `company_memberships`;
- company roles and permissions.

The backend must not rely on unverified user metadata for authorization.

### 5.4 API style

Use versioned REST APIs.

Initial prefix:

```text
/api/v1
```

Swagger/OpenAPI documentation is mandatory.

### 5.5 Validation

Use DTO-based validation at the API boundary.

Validation must cover:

- required fields;
- formats;
- enums;
- number ranges;
- dates;
- string lengths;
- pagination limits.

Business validation belongs in use cases and domain services.

### 5.6 Background processing

Background jobs are introduced only for tasks that should not block the request lifecycle.

Examples:

- notifications;
- email delivery;
- SMS delivery;
- delayed expiration;
- report generation;
- webhook retries;
- reconciliation.

The first version may use a simple job abstraction. A queue provider can be introduced later through an infrastructure adapter.

---

## 6. Backend Layer Responsibilities

### 6.1 Presentation layer

Contains:

- controllers;
- request DTOs;
- response DTOs;
- guards;
- decorators;
- interceptors;
- API documentation;
- HTTP mapping.

Responsibilities:

- accept and validate input;
- obtain authentication and tenant context;
- invoke exactly one application use case;
- map application results to HTTP responses.

Must not contain:

- SQL;
- database transactions;
- pricing rules;
- seat-allocation logic;
- payment-state logic;
- cross-module orchestration.

### 6.2 Application layer

Contains:

- use cases;
- commands;
- queries;
- application services;
- transaction orchestration;
- ports/interfaces;
- result models.

Responsibilities:

- coordinate domain behavior;
- load required entities;
- call repositories;
- enforce authorization-sensitive workflow rules;
- manage transactions;
- publish domain/application events;
- provide deterministic outcomes.

Examples:

```text
CreateBookingUseCase
CancelBookingUseCase
ConfirmPaymentUseCase
IssueTicketUseCase
StartTripUseCase
```

### 6.3 Domain layer

Contains:

- entities;
- value objects;
- domain services;
- domain errors;
- domain policies;
- state-transition rules.

Responsibilities:

- business invariants;
- state transitions;
- calculations;
- behavior independent of infrastructure.

The domain layer must remain framework-independent where practical.

### 6.4 Infrastructure layer

Contains:

- PostgreSQL repositories;
- Supabase Auth adapter;
- storage adapter;
- payment adapters;
- notification adapters;
- queue adapters;
- external API clients;
- logger implementation;
- configuration providers.

Infrastructure classes implement interfaces defined by the application or domain layers.

---

## 7. Module Boundaries

The initial backend modules are:

```text
auth
profiles
companies
memberships
branches
staff
cities
stations
fleet
routes
trips
passengers
bookings
payments
tickets
maintenance
commissions
audit
health
```

The authoritative domain breakdown remains in `03-backend-modules.md`.

### 7.1 Rules between modules

- A module must not access another module's database tables directly.
- Cross-module operations go through exported application services or ports.
- Shared database transactions may be coordinated by a dedicated use case.
- Circular dependencies are forbidden.
- `forwardRef()` must not be used as a normal design solution.
- Shared types must not become a hidden business module.
- Business rules must live in the owning module.

### 7.2 Module ownership examples

- Bookings owns booking lifecycle and seat reservation orchestration.
- Payments owns payment lifecycle, reconciliation, and refunds.
- Tickets owns issuance, QR verification, and boarding validation.
- Trips owns trip scheduling and operational state.
- Fleet owns buses and seat layouts.
- Companies owns tenant-level company configuration.
- Memberships owns company access and role assignment.
- Audit owns append-only audit access patterns.

---

## 8. Recommended Project Structure

The exact monorepo placement must follow `11-monorepo-structure.md`.

Recommended API structure:

```text
apps/
  api/
    src/
      main.ts
      app.module.ts

      config/
        app.config.ts
        auth.config.ts
        database.config.ts
        validation.ts

      common/
        constants/
        decorators/
        errors/
        filters/
        guards/
        interceptors/
        pipes/
        types/
        utils/

      infrastructure/
        auth/
        database/
        logging/
        storage/
        notifications/
        queue/
        integrations/

      modules/
        auth/
          presentation/
          application/
          domain/
          infrastructure/
          auth.module.ts

        bookings/
          presentation/
            bookings.controller.ts
            dto/
          application/
            use-cases/
            ports/
            models/
          domain/
            entities/
            value-objects/
            services/
            errors/
          infrastructure/
            repositories/
            mappers/
          bookings.module.ts

        payments/
        tickets/
        trips/
        ...

      health/
        health.controller.ts
        health.module.ts

      testing/
        factories/
        fixtures/
        helpers/
```

### 8.1 File naming

Use kebab-case for file names.

Examples:

```text
create-booking.use-case.ts
booking.repository.ts
booking.entity.ts
create-booking.dto.ts
booking-response.dto.ts
```

### 8.2 Class naming

Use explicit suffixes:

```text
CreateBookingUseCase
BookingRepository
PostgresBookingRepository
CreateBookingDto
BookingResponseDto
CompanyAccessGuard
DomainConflictError
```

Avoid generic names such as:

```text
Utils
HelperService
Manager
CommonService
BaseService
```

unless the responsibility is genuinely clear and narrow.

---

## 9. Request Lifecycle

A standard protected request follows this sequence:

```text
HTTP Request
  ↓
Correlation ID
  ↓
Security Headers / Rate Limit
  ↓
Authentication Guard
  ↓
Tenant Context Resolution
  ↓
Permission Guard
  ↓
DTO Validation
  ↓
Controller
  ↓
Application Use Case
  ↓
Domain Rules
  ↓
Repository / Transaction
  ↓
Audit / Events
  ↓
Response Mapping
  ↓
Structured Log
```

### 9.1 Request context

Each request context should contain, when available:

```ts
type RequestContext = {
  requestId: string;
  userId: string;
  companyId?: string;
  membershipId?: string;
  role?: string;
  permissions: string[];
};
```

The request context must be created by trusted backend code.

---

## 10. Authentication and Authorization

### 10.1 Authentication

The backend must:

- read the bearer token;
- verify its signature and claims;
- reject expired or malformed tokens;
- extract the authenticated user ID;
- resolve the corresponding profile.

### 10.2 Tenant resolution

For tenant-scoped endpoints, the backend must resolve the active company.

The company may come from:

- an explicit route parameter;
- a trusted request header;
- a membership selection workflow;
- a resource loaded from the database.

Regardless of source, active membership must be verified.

### 10.3 Authorization

Authorization uses both roles and permissions.

Roles provide a manageable default permission set.

Permissions provide explicit enforcement.

Example permissions:

```text
companies.read
companies.update
branches.manage
staff.manage
fleet.manage
routes.manage
trips.manage
bookings.create
bookings.read
bookings.cancel
payments.confirm
payments.refund
tickets.issue
tickets.scan
maintenance.manage
reports.read
audit.read
```

### 10.4 Defense in depth

Authorization is enforced in two places:

1. application/API authorization;
2. PostgreSQL RLS and database constraints.

Neither layer is treated as optional.

---

## 11. Multi-Tenancy Rules

Voyagi uses shared-schema multi-tenancy.

Tenant-owned tables include a company identifier directly or through a guaranteed relationship.

Mandatory rules:

- every tenant query must be scoped;
- every tenant write must verify ownership;
- cross-company access is denied by default;
- database RLS remains enabled;
- company IDs supplied by clients are untrusted;
- background jobs must restore tenant context explicitly;
- logs and audit events should include company ID when applicable;
- cache keys must include tenant ID;
- idempotency keys must be tenant-aware.

No repository method may expose an unscoped tenant query without a deliberate and reviewed reason.

Forbidden example:

```ts
findById(id: string)
```

Preferred:

```ts
findById(companyId: string, id: string)
```

for tenant-owned resources.

---

## 12. Database and Repository Rules

### 12.1 Repository responsibility

Repositories:

- execute persistence operations;
- map database rows to application/domain models;
- preserve tenant scope;
- expose transaction-aware methods;
- avoid embedding unrelated business workflows.

Repositories must not:

- return raw database clients to controllers;
- bypass tenant checks;
- hide expensive queries;
- implement HTTP concerns.

### 12.2 Transactions

Transactions are mandatory for workflows that update multiple related records.

Examples:

- booking plus seat reservations;
- payment confirmation plus booking transition;
- ticket issuance plus booking event;
- refund plus financial transaction;
- route price update plus price history.

Transaction boundaries belong in the application layer.

### 12.3 Concurrency

Use database constraints and explicit locking where required.

For high-contention workflows:

- use atomic SQL;
- use row locks only when necessary;
- use optimistic locking through `version` columns;
- convert database conflicts into stable application errors;
- never use read-then-write logic without protection.

### 12.4 SQL safety

- parameterized queries only;
- no string-built SQL containing user input;
- explicit selected columns;
- no `SELECT *` in production repositories;
- pagination required for collections;
- indexes reviewed for frequently executed queries.

### 12.5 Migrations

- all schema changes use migrations;
- never edit an already-applied migration;
- create a new migration for every change;
- migration names must be descriptive;
- migrations must be tested locally;
- remote push requires dry-run review;
- schema and architecture documentation must be updated together.

---

## 13. Booking Architecture

Booking is a workflow, not a CRUD resource.

The booking implementation must follow:

- passenger flow in `05-passenger-booking-sequence.md`;
- agent flow in `06-agent-booking-sequence.md`;
- seat transitions in `07-seat-state-machine.md`;
- booking transitions in `08-booking-state-machine.md`;
- payment transitions in `09-payment-state-machine.md`;
- rules in `12-business-rules.md`.

### 13.1 Booking creation requirements

A booking creation use case must:

1. authenticate the actor;
2. resolve tenant context when company-operated;
3. validate trip availability;
4. validate requested seats;
5. calculate authoritative price;
6. create or resolve passenger records;
7. create the booking;
8. reserve seats atomically;
9. write booking events;
10. return an idempotent result.

### 13.2 Price authority

The backend calculates final prices.

Clients may display estimates but cannot dictate the authoritative total.

Price snapshots must be persisted to preserve historical accuracy.

### 13.3 Seat consistency

Seat uniqueness and state transitions are enforced through both:

- booking-domain checks;
- database constraints and transactions.

A seat conflict returns a stable conflict response and does not leave partial records.

---

## 14. Payments Architecture

Payment providers must be accessed through a provider interface.

Example:

```ts
interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>;
  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>;
}
```

Provider-specific payloads must not leak into the domain layer.

### 14.1 Webhooks

Webhook handlers must:

- verify provider signatures;
- store or derive a unique provider event ID;
- process events idempotently;
- tolerate duplicate delivery;
- reject invalid state transitions;
- log sanitized provider metadata;
- return quickly;
- queue slow follow-up work when necessary.

### 14.2 Financial immutability

Confirmed financial history must not be edited destructively.

Corrections must be represented through explicit compensating records such as refunds, reversals, or adjustments.

---

## 15. Ticket Architecture

Tickets are issued only after the relevant booking and payment conditions are satisfied.

Rules:

- QR content must not expose sensitive internal data;
- only a cryptographic token or hash-derived identifier is used;
- stored QR material follows the database convention;
- ticket verification is server-authoritative;
- ticket validation is idempotent;
- boarding scans create auditable events;
- revoked or refunded tickets cannot be accepted.

---

## 16. Error Handling

### 16.1 Error categories

Use stable application error categories:

```text
VALIDATION_ERROR
UNAUTHENTICATED
FORBIDDEN
NOT_FOUND
CONFLICT
BUSINESS_RULE_VIOLATION
RATE_LIMITED
DEPENDENCY_FAILURE
INTERNAL_ERROR
```

### 16.2 Response format

Recommended error format:

```json
{
  "success": false,
  "error": {
    "code": "SEAT_ALREADY_RESERVED",
    "message": "The selected seat is no longer available.",
    "details": {
      "seatId": "..."
    }
  },
  "requestId": "..."
}
```

Do not expose:

- stack traces;
- SQL text;
- database credentials;
- provider secrets;
- internal table structure;
- raw exceptions.

### 16.3 Exception mapping

- domain errors map to business responses;
- unique conflicts map to `409 Conflict`;
- missing resources map to `404 Not Found`;
- invalid authentication maps to `401 Unauthorized`;
- failed authorization maps to `403 Forbidden`;
- unexpected failures map to sanitized `500 Internal Server Error`.

---

## 17. API Standards

### 17.1 Versioning

All public endpoints begin with:

```text
/api/v1
```

Breaking changes require a new API version or a documented compatibility plan.

### 17.2 Response conventions

Successful collection response:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 0
  }
}
```

Successful single-resource response:

```json
{
  "success": true,
  "data": {}
}
```

### 17.3 Pagination

Use bounded pagination.

Default:

```text
pageSize = 20
```

Maximum:

```text
pageSize = 100
```

Cursor pagination should be preferred later for very large or real-time datasets.

### 17.4 Dates and times

- use ISO 8601 in APIs;
- persist timezone-aware timestamps;
- store canonical timestamps in UTC;
- preserve business timezone where scheduling requires it;
- do not accept ambiguous local datetime values without timezone context.

### 17.5 Money

- use database numeric/decimal representations;
- do not use floating-point arithmetic;
- always include currency;
- define rounding rules;
- preserve price snapshots.

### 17.6 Idempotency header

Retryable creation endpoints should support:

```text
Idempotency-Key
```

The key must be scoped to the relevant tenant and operation.

---

## 18. Logging and Audit

### 18.1 Structured logging

Logs should contain:

```text
timestamp
level
service
environment
requestId
userId
companyId
module
operation
durationMs
status
errorCode
```

Do not log:

- passwords;
- access tokens;
- refresh tokens;
- full payment details;
- sensitive passenger information;
- private QR material.

### 18.2 Audit logs

Audit records are for important business and security actions.

Examples:

- role changes;
- company settings changes;
- booking cancellation;
- payment refund;
- ticket revocation;
- route price change;
- maintenance update;
- security-sensitive access.

Application logs and audit logs serve different purposes and must not be treated as the same system.

---

## 19. Configuration and Secrets

All environment-specific configuration must be externalized.

Examples:

```text
NODE_ENV
PORT
DATABASE_URL
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
JWT_ISSUER
JWT_AUDIENCE
CORS_ORIGINS
LOG_LEVEL
```

Rules:

- validate configuration during startup;
- fail fast on missing required values;
- never commit production secrets;
- provide `.env.example`;
- separate public and server-only keys;
- never expose the service role key to clients;
- use secret management in production.

---

## 20. Security Baseline

The backend must include:

- strict CORS configuration;
- security headers;
- request size limits;
- rate limiting;
- DTO validation;
- token verification;
- role and permission guards;
- tenant isolation;
- SQL parameterization;
- safe error responses;
- log redaction;
- webhook signature verification;
- idempotency protection;
- dependency vulnerability checks;
- secure production configuration.

Public endpoints must be explicitly documented.

---

## 21. Testing Strategy

### 21.1 Unit tests

Cover:

- domain rules;
- state transitions;
- price calculations;
- permission policies;
- use-case branching;
- mapping of known errors.

### 21.2 Integration tests

Cover:

- repositories;
- transactions;
- RLS behavior;
- constraints;
- migration compatibility;
- database conflict handling.

### 21.3 End-to-end tests

Cover critical workflows:

- authentication;
- company access;
- trip search;
- passenger booking;
- agent booking;
- seat conflict;
- payment confirmation;
- ticket issuance;
- ticket scan;
- cancellation;
- refund;
- cross-tenant access rejection.

### 21.4 Test requirements

- tests must be deterministic;
- each test owns or cleans its data;
- tests must not depend on execution order;
- critical state machines require full transition coverage;
- production bugs should receive regression tests.

---

## 22. Performance Rules

Initial performance safeguards:

- pagination for all lists;
- avoid N+1 queries;
- explicit indexes for common filters;
- query plans reviewed for critical workflows;
- minimal transaction duration;
- bounded payload sizes;
- no synchronous external calls inside long database transactions;
- caching introduced only for measured needs;
- slow-query logging enabled in production operations.

The booking path receives the highest performance and concurrency attention.

---

## 23. External Integrations

Every external provider must be wrapped behind an adapter.

Examples:

- payment gateway;
- SMS;
- email;
- object storage;
- maps;
- analytics;
- future government or partner APIs.

Integration requirements:

- timeouts;
- retry policy;
- circuit-breaking strategy when needed;
- idempotency;
- sanitized logging;
- provider error mapping;
- test doubles;
- configuration validation.

---

## 24. Events and Future Asynchronous Architecture

Use domain or application events for side effects that should not be tightly coupled.

Examples:

```text
BookingCreated
BookingConfirmed
BookingCancelled
PaymentConfirmed
PaymentRefunded
TicketIssued
TicketValidated
TripStarted
TripCompleted
```

In v1, events may be handled in-process.

The event contracts must be designed so that future migration to a queue or message broker does not require rewriting core business logic.

Do not use asynchronous events for consistency-critical operations that must succeed in the same transaction.

---

## 25. Dependency Rules

Mandatory dependency rules:

- presentation may depend on application;
- application may depend on domain;
- infrastructure may implement application/domain ports;
- domain must not depend on infrastructure;
- modules must not import internal files from other modules;
- imports must use public module exports;
- circular imports are forbidden;
- common code must remain business-neutral;
- infrastructure providers must be replaceable through interfaces.

These rules should later be enforced with lint rules or architecture tests.

---

## 26. Definition of Done for a Backend Feature

A backend feature is complete only when:

- its use case is documented;
- authorization rules are defined;
- tenant scope is enforced;
- DTO validation exists;
- business errors are stable;
- transaction boundaries are correct;
- audit requirements are implemented;
- Swagger is updated;
- unit tests pass;
- integration tests pass where applicable;
- critical E2E tests pass;
- linting passes;
- type checking passes;
- documentation is updated;
- no secrets are committed.

---

## 27. Implementation Roadmap

### Phase 1 — Foundation

- initialize NestJS API;
- configuration validation;
- database connection;
- structured logging;
- request correlation;
- global validation;
- global exception filter;
- API versioning;
- Swagger;
- health endpoints;
- test harness.

### Phase 2 — Authentication and Tenant Context

- Supabase JWT verification;
- authenticated profile resolution;
- company membership resolution;
- roles and permissions;
- tenant context decorator;
- authorization guards;
- cross-tenant tests.

### Phase 3 — Company Operations

- companies;
- memberships;
- branches;
- staff;
- settings.

### Phase 4 — Transport Catalog

- cities;
- stations;
- buses;
- seat layouts;
- routes;
- route prices.

### Phase 5 — Trip Operations

- trip creation;
- schedules;
- trip status;
- bus assignment;
- operational events.

### Phase 6 — Booking Engine

- trip availability;
- passenger creation;
- passenger booking;
- agent booking;
- seat reservation;
- idempotency;
- booking events;
- cancellation.

### Phase 7 — Payments and Tickets

- payment initiation;
- confirmation;
- provider webhooks;
- refunds;
- ticket issuance;
- QR validation;
- boarding scan.

### Phase 8 — Maintenance and Commissions

- maintenance records;
- agent commission transactions;
- operational audit.

### Phase 9 — Hardening

- rate limits;
- performance tests;
- security review;
- failure recovery;
- observability;
- deployment validation.

---

## 28. Architecture Decision Records

Important decisions must be recorded under:

```text
architecture/adr/
```

Recommended naming:

```text
0001-use-nestjs.md
0002-use-modular-monolith.md
0003-use-supabase-auth.md
0004-use-direct-postgresql-access.md
0005-use-shared-schema-multitenancy.md
```

Each ADR should contain:

- status;
- context;
- decision;
- consequences;
- alternatives considered.

---

## 29. Explicit Non-Goals for v1

The first version does not require:

- microservices;
- Kubernetes;
- event sourcing;
- CQRS everywhere;
- multiple databases;
- global multi-region writes;
- a custom identity provider;
- premature Redis caching;
- a message broker without a proven need;
- generic abstractions for hypothetical providers.

These may be introduced later through documented ADRs when justified.

---

## 30. Final Architectural Contract

The Voyagi backend will be built as a secure, multi-tenant, modular NestJS application using pragmatic Clean Architecture.

The following rules are non-negotiable:

1. Tenant isolation is enforced in every layer.
2. Business workflows are implemented as explicit use cases.
3. Database constraints remain authoritative.
4. Complex writes use transactions.
5. Retryable operations support idempotency.
6. Controllers contain no business logic.
7. Modules do not access each other's tables directly.
8. Financial and audit history remains immutable.
9. Every critical workflow is tested.
10. Architecture changes require documentation and review.

Any implementation that violates these rules must be corrected before merge.
