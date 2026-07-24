# Voyagi

Multi-tenant SaaS platform for intercity bus transportation companies.

This is a pnpm monorepo. The authoritative architecture lives in [`architecture/`](./architecture);
the backend is implemented phase by phase per
[`architecture/18-backend-implementation-guide.md`](./architecture/18-backend-implementation-guide.md).

## Repository layout

```text
apps/
  backend/     NestJS API (all booking, payment and business logic)
  dashboard/   Next.js panels (not yet implemented)
  mobile/      Flutter passenger app (not yet implemented)
packages/      shared internal packages
supabase/      database as code (migrations, seed, config)
architecture/  architecture documents (source of truth)
```

> **Note on placement:** architecture docs 13 and 18 mention `apps/api`, while the
> monorepo structure (doc 11) and this repository use `apps/backend`. The repository
> and doc 11 are authoritative, so the API lives in `apps/backend`.

## Requirements

- Node.js `>= 22.13.0` (required by pnpm 11.9.0; repository developed on Node 26)
- pnpm `>= 11` (pinned to `pnpm@11.9.0` via `packageManager`)

## Getting started

```bash
pnpm install
cp .env.example apps/backend/.env
pnpm start:dev
```

The API starts on `http://localhost:3000` with the global prefix `/api` and URI
versioning. Foundation endpoints:

```text
GET /api/v1/health/live    -> liveness probe (public)
GET /api/v1/health/ready   -> readiness probe (public)
GET /api/v1/auth/me        -> verified principal (requires Bearer token)
GET /api/docs              -> Swagger UI (when SWAGGER_ENABLED=true)
```

All responses use a stable envelope:

```jsonc
// success
{ "success": true, "data": { "status": "ok" }, "requestId": "..." }
// error
{ "success": false, "error": { "code": "RESOURCE_NOT_FOUND", "message": "..." }, "requestId": "...", "timestamp": "...", "path": "..." }
```

Every request carries an `X-Request-Id` (accepted from the client if valid,
otherwise generated) which is echoed in the response header, structured logs and
error bodies.

## Workspace commands

Run from the repository root (they delegate to `apps/backend`):

```bash
pnpm lint             # ESLint
pnpm typecheck        # tsc --noEmit
pnpm test             # unit tests (Jest)
pnpm test:integration # integration tests against the local real PostgreSQL schema
pnpm test:e2e         # end-to-end tests (Jest + supertest)
pnpm build            # nest build
pnpm start:dev        # watch-mode dev server
```

## Configuration

Environment variables are typed, validated at startup and fail fast when invalid.
See [`.env.example`](./.env.example) for the full list, including the Supabase
authentication variables (Phase 3).

## Database (Phase 2)

The backend talks to PostgreSQL through a thin, explicit
[`pg`](https://node-postgres.com) connection pool (no ORM). All database access
goes through the infrastructure module at
[`apps/backend/src/infrastructure/database`](./apps/backend/src/infrastructure/database).

### Configure

- `DATABASE_URL` is the connection string. **In production it must be set
  explicitly** — the app fails fast if it is missing. Outside production it
  defaults to the local Supabase stack (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`).
- Pool size, timeouts and SSL mode are configurable (see `.env.example`).
- `DATABASE_SSL_MODE`: `disable | require | no-verify | verify-ca | verify-full`.
  Verification is only relaxed for modes that request it; use `verify-full` with
  a CA for the strongest production posture.

### Local database & tests

Start the local Supabase stack (PostgreSQL on port 54322), then:

```bash
supabase start          # from the repo root; provides the local database
supabase db reset       # applies every migration to a disposable local database
pnpm test:integration   # critical booking/availability suites fail if DB is unavailable
```

Feature integration tests exercise the real migrated schema. Most fixtures are
wrapped in transactions and rolled back. Concurrency cases use separate
connections and narrowly scoped cleanup; the booking suite rejects non-local
database hosts so this cleanup cannot run against a shared or production database.
Use a disposable local Supabase instance and run `supabase db reset` before the
full database verification.

### Health readiness

`GET /api/v1/health/ready` runs a bounded `SELECT 1` and returns `200`
(`checks.database = "up"`) when the database is reachable, or `503`
(`DEPENDENCY_FAILURE`) when it is not. `GET /api/v1/health/live` is independent
of the database and never fails because of a database outage.

### Using the database in later phases

Feature modules obtain the abstractions by injection (the module is global):

```ts
import {
  DatabaseService,
  TransactionManager,
} from "../../infrastructure/database";

// Single query — always parameterized (never string-interpolate user input):
await this.database.query("SELECT id FROM trips WHERE company_id = $1", [
  companyId,
]);

// Atomic multi-statement work:
await this.transactions.run(async (tx) => {
  await tx.query("INSERT INTO bookings (...) VALUES ($1, ...)", [/* ... */]);
  await tx.query("INSERT INTO booking_events (...) VALUES ($1, ...)", [
    /* ... */
  ]);
}); // COMMIT on success, ROLLBACK on any thrown error; the client is always released.
```

Rules for repositories added later:

- always pass values via query parameters; never interpolate user input into SQL;
- accept a `DatabaseExecutor` so a repository works both ambiently and inside a
  transaction; do **not** call `transactions.run` inside another `run` callback
  (nesting is not supported — pass the `Transaction` down instead);
- let driver errors propagate — they are translated into stable, safe
  application errors (`UNIQUE_VIOLATION` → 409, check/not-null → 422, connection/
  timeout → 503, unknown → sanitized 500);
- page list queries with the shared bounded pagination primitive
  (`resolvePagination` → `limit`/`offset`, `buildPaginationMeta` → response
  `meta`) in [`src/common/pagination`](./apps/backend/src/common/pagination)
  (default page size 20, max 100).

### Graceful shutdown

The connection pool is closed on `SIGTERM`/`SIGINT` via `onApplicationShutdown`,
so in-flight queries can finish and connections are released cleanly. A bounded
shutdown watchdog (`SHUTDOWN_TIMEOUT_MS`, default 15000) force-exits if graceful
shutdown overruns the deadline, so the process can never hang (see the Phase 18.1
production-readiness docs under [`docs/operations`](./docs/operations)).

### Never logged

Connection strings / `DATABASE_URL`, SQL parameter values, access tokens,
passwords, cookies and authorization headers are never logged. Query logging is
metadata-only (operation name, duration, sanitized SQLSTATE); raw SQL text is
logged only when `DATABASE_LOG_QUERIES=true` (development), and parameters never
are.

## Authentication (Phase 3)

The API is **secure by default**: a global authentication guard protects every
route unless it is explicitly marked `@Public()` (currently only the health
probes). Callers present a Supabase-issued access token as
`Authorization: Bearer <token>`. The auth module lives in
[`apps/backend/src/modules/auth`](./apps/backend/src/modules/auth) and performs
token verification only — no authorization, tenant, or profile resolution (those
belong to later phases).

### How tokens are verified

- Verification is **asymmetric** against the Supabase JWKS endpoint — no shared
  secret is used or accepted. `jose` checks the signature, algorithm allow-list
  (`RS256`/`ES256` by default; `HS*` and `none` are rejected), issuer, audience,
  expiry and not-before.
- The JWKS is fetched lazily and cached, with automatic key-rotation handling
  (refetch on an unknown `kid`) and a bounded fetch timeout.
- The verified identity is exposed to controllers as an immutable
  `AuthenticatedPrincipal` (via the `@CurrentPrincipal()` decorator) carrying
  only whitelisted identity claims (`userId`, `email`, `role`, `sessionId`,
  `issuedAt`, `expiresAt`). Raw claims and the token are never surfaced.

### Configure

- `SUPABASE_URL` derives the issuer and JWKS URL. **In production it must be set
  explicitly** (or the explicit `SUPABASE_JWT_ISSUER` / `SUPABASE_JWKS_URL`) —
  the app fails fast when the JWKS URL cannot be resolved. Outside production it
  defaults to the local Supabase stack (`http://127.0.0.1:54321`).
- Audience, algorithms, clock tolerance, JWKS cache TTL and fetch timeout are
  configurable (see `.env.example`).

### Failure semantics

Failures always **fail closed** and never act as a verification oracle:

- `401 UNAUTHENTICATED` — missing or malformed `Authorization` header.
- `401 TOKEN_EXPIRED` — the token is otherwise valid but expired (clients should
  refresh). This is the only distinguished cryptographic outcome.
- `401 TOKEN_INVALID` — every other verification failure (bad signature, unknown
  key, wrong issuer/audience, disallowed algorithm, malformed token, missing
  subject) collapses to a single generic code.
- `503 DEPENDENCY_FAILURE` — the JWKS endpoint is unreachable; access is denied
  because the server cannot verify credentials, not because they are invalid.

`403` is never returned by authentication — it is reserved for authorization in
a later phase.

### The `GET /api/v1/auth/me` endpoint

Returns the safe subset of the verified principal for the presented token. It
does not resolve the profile record or any authorization data.

```bash
curl -H "Authorization: Bearer <access-token>" http://localhost:3000/api/v1/auth/me
# { "success": true, "data": { "userId": "…", "email": "…", "role": "authenticated", "expiresAt": 1700000000 }, "requestId": "…" }
```

### Protecting routes in later phases

Routes are protected automatically. Mark the rare public route with `@Public()`,
and read the caller's identity with the parameter decorator:

```ts
import { Public } from '../../common/decorators/public.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';

@Get('me')
me(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
  return { userId: principal.userId };
}
```

### Never logged

Access tokens, the `Authorization` header, and raw JWT claims are never logged.
Authentication failures log only a sanitized internal reason, the request id,
the HTTP status and the duration — never the token or credential material.

## Authorization (Phase 4)

Authorization is layered on top of authentication and enforced by a second
global guard, the **authorization guard**, which runs after the authentication
guard. The module lives in
[`apps/backend/src/modules/authorization`](./apps/backend/src/modules/authorization)
and decides access from **permissions** — it performs no authentication and, by
design, does not trust any role or permission carried inside a token.

> Phase 4 delivers the authorization **infrastructure** only. The database-backed
> resolution of profiles and company memberships (which produces the real
> permission set) is bound in a later phase. Until then a minimal default
> resolver keeps the pipeline functional (see
> [Context resolution](#context-resolution)).

### Request pipeline

```text
Rate limit  →  Authentication guard  →  Authorization guard  →  Controller
(429)          (401 / 503)              (403)
```

### Permission model

Permissions are `resource.action` strings defined once in the central catalog
[`permission.enum.ts`](./apps/backend/src/modules/authorization/permission.enum.ts)
(e.g. `companies.read`, `bookings.cancel`, `payments.refund`). They are never
written as inline string literals.

### Declaring requirements

Protect a route with `@RequirePermissions(...)`. Requirements declared on the
controller and the handler **combine** (all are required). Routes with no
requirement are reachable by any authenticated caller.

```ts
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { AuthorizationCtx } from '../authorization/decorators/authorization-context.decorator';
import type { AuthorizationContext } from '../authorization/authorization-context';
import { Permission } from '../authorization/permission.enum';

@Get(':companyId/settings')
@RequirePermissions(Permission.CompaniesRead)
getSettings(@AuthorizationCtx() context: AuthorizationContext) {
  return this.settings.forCompany(context.companyId);
}
```

The guard resolves the caller's `AuthorizationContext` — `userId`, `profileId`,
`companyId`, `membershipId`, `role`, `permissions` — attaches it to the request,
and exposes it through the `@AuthorizationCtx()` parameter decorator. The active
company (tenant) is taken from a `companyId` route parameter or the
`X-Company-Id` header; it names which company the caller acts on and is **never**
treated as proof of membership — the resolver must verify an active membership.

For Swagger, a permission-protected endpoint should document its failure modes
with `@ApiForbiddenResponse()` (and `@ApiBearerAuth('bearer')`, already applied
where authentication is required), so the `403` contract appears in the OpenAPI
document alongside the operation.

### Policies

Permission checks run through a small policy seam: an `AuthorizationPolicy`
evaluates a resolved context to allow/deny, and the `PolicyEvaluator` composes
policies conjunctively (deny wins, first denial short-circuits). This phase ships
only the generic `PermissionPolicy`; business-specific policies (e.g. resource
ownership) are added by their owning modules later without changing the guard.

### Context resolution

The guard resolves the context through the `AUTHORIZATION_CONTEXT_RESOLVER` port
([`authorization-context-resolver.ts`](./apps/backend/src/modules/authorization/authorization-context-resolver.ts)).
It is bound by default to a minimal
[`DefaultAuthorizationContextResolver`](./apps/backend/src/modules/authorization/default-authorization-context.resolver.ts)
that derives a valid context from the verified principal and grants **no**
permissions — so the authorization layer is functional and secure out of the
box without any Users/Memberships domain. Permission-protected routes therefore
return a correct `403` decision rather than a "dependency unavailable" error.

The identity/tenant phase replaces it purely through DI by binding a
database-backed resolver (reading `profiles` and `company_memberships`) to the
same token; a locally-provided binding takes precedence over the module default,
and no other code changes.

### Failure semantics

Authorization always **fails closed** and never returns `401` (that belongs to
authentication):

- `403 FORBIDDEN` — the caller lacks a required permission, or no active
  authorization context could be established (e.g. no active membership). The
  response is intentionally generic; the specific missing permissions appear
  only in the internal log reason, so the API is not a permission-enumeration
  oracle.

### Never logged

Denials log only a sanitized internal reason (e.g. `permission_denied`) and the
request id — never tokens, headers, or the caller's permission set.

## Identity — profiles & memberships (Phase 5)

The [`identity` module](./apps/backend/src/modules/identity) implements the
Users & Identity domain: it resolves an authenticated user to their backend
profile and company memberships, and provides the **database-backed**
authorization-context resolver that replaces the Phase 4 default.

It reads the existing `profiles` and `company_memberships` tables only — no
migrations were needed. Roles are the database `user_role_enum`; there is no
separate permissions table, so permissions are derived from the role in the
application layer.

### Endpoints

| Method & path                                                | Auth               | Notes                                                              |
| ------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------ |
| `GET /api/v1/profiles/me`                                    | authenticated      | The caller's profile; `404` if none.                               |
| `PATCH /api/v1/profiles/me`                                  | authenticated      | Updates `fullName` / `phoneNumber` only (the RLS-editable fields). |
| `GET /api/v1/profiles/me/companies`                          | authenticated      | Paginated list of companies the caller actively belongs to.        |
| `GET /api/v1/companies/:companyId/memberships`               | `memberships.read` | Paginated, tenant-scoped list.                                     |
| `GET /api/v1/companies/:companyId/memberships/:membershipId` | `memberships.read` | Single membership, scoped to the company.                          |

### Profile resolution

The auth user id always comes from the verified `AuthenticatedPrincipal` — never
from the request body or a client-supplied id. `id`/`bigint` identifiers are
validated before they reach a query (a malformed value fails closed to `403`/
`404`, never a `500`). A missing profile is surfaced as `404 PROFILE_NOT_FOUND`
on self-service routes, but as a generic `403` on authorization paths (it never
reveals whether a profile exists). A disabled profile (`is_active = false`) is
denied authorization.

### Company-context & membership resolution

The target company id comes from the `:companyId` route parameter (or the
`X-Company-Id` header). It identifies **which** tenant the caller is acting on —
it is never proof of membership. The resolver verifies an active membership in
that exact company server-side. Inactive/wrong-company memberships yield no
context (`403`). A user may hold several active memberships in one company; the
effective permission set is the **de-duplicated union** across them. No
"primary" membership is invented: the informational `membershipId`/`role` on the
`AuthorizationContext` are surfaced **only when exactly one active membership**
makes them unambiguous, and are left undefined otherwise (there is no documented
precedence rule to pick a winner, so none is fabricated). The authoritative
grant is always the union, so no ordering can widen or narrow access.

### Role → permission resolution

[`role-permissions.ts`](./apps/backend/src/modules/identity/role-permissions.ts)
is the single expansion of each role into the central `Permission` catalog. The
database has **no** `roles`/`permissions`/`role_permissions` table (roles are the
`public.user_role_enum` on `company_memberships`), so this map is the
application-side "manageable default permission set". It is **strict and
cited**: every grant traces to a specific RLS policy, an authorization predicate,
or a documented business-rule flow; anything not cited is **not** granted (fail
closed). An RLS _read_ policy is never used to justify an unrelated write, and a
role value the application does not recognize is dropped and logged (count only),
never granted.

| Role              | Permissions                      | Basis                                                                     |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------- |
| `SUPER_ADMIN`     | whole catalog                    | `private.is_super_admin()` short-circuits every RLS predicate.            |
| `COMPANY_MANAGER` | whole catalog                    | `private.can_manage_company()` + §7.2 ownership + manager business flows. |
| `BRANCH_EMPLOYEE` | the read set only                | company-scoped RLS _read_ policies; no documented write.                  |
| `AGENT`           | read set **+** `bookings.create` | read policies + the agent as booking creator (`12-business-rules.md` §1). |
| `PASSENGER`       | none                             | reaches own resources by ownership, never a company-scoped permission.    |

The **read set** is `companies.read`, `branches.read`, `staff.read`,
`fleet.read`, `routes.read`, `trips.read`, `bookings.read`, `payments.read`,
`tickets.read`, `maintenance.read` — the resources admitted by the company-scoped
RLS read policies. `memberships.read` and `audit.read` are gated on
`can_manage_company()`, so they belong to managers (and super-admins) only, not
to employees or agents. Branch-office ticketing/payment **writes** are
deliberately deferred to the phase that defines those flows rather than granted
here without a citation. The exact policy-per-grant citations live in the module
doc-comment; each row above is asserted in `role-permissions.spec.ts` (including
that employees and agents never receive an undocumented write).

### Branch access

[`branch-access.ts`](./apps/backend/src/modules/identity/branch-access.ts)
mirrors `private.has_branch_access()`: `company-wide` for a manager/super-admin,
`restricted` to the union of an employee/agent's branch grants, or `none`.
Branch access is resolved and exposed through the identity domain; it is not
added to `AuthorizationContext` (whose contract is unchanged).

### Branch-scoped authority (no permission/branch cross-product)

The context's `permissions` and `branchAccess` are each a **caller-wide union**
across memberships. They are correct for _company-scoped_ decisions, but must
**never be intersected** to make a _branch-scoped_ one — that would form a
cross-product across memberships. Concretely: an `AGENT` scoped to Branch A
(granting `bookings.create`) plus a `BRANCH_EMPLOYEE` scoped to Branch B
(granting no create) would, under a naive `permissions ∩ branchAccess` check,
appear to allow `bookings.create` in Branch B — which no single membership ever
granted.

[`entitlements.ts`](./apps/backend/src/modules/identity/entitlements.ts)
prevents this by construction. `resolveMembershipContext` also returns an
`entitlements` list with **one entry per membership**, each keeping that
membership's permissions coupled to that same membership's branch scope.
Branch-scoped decisions go through:

- `effectivePermissionsForBranch(entitlements, branchId)` — the union of
  permissions from only the memberships whose own scope reaches that branch;
- `canExercisePermissionInBranch(entitlements, permission, branchId)` — true
  only when a **single** membership grants both the permission and access to the
  branch.

A company-wide membership (manager/super-admin) reaches every branch, exactly
because that role genuinely holds company-wide authority; a branch-scoped role's
permissions never leak beyond its own branch. Phase 5 exposes no branch-scoped
_endpoint_ yet, so this is the mechanism a future branch-scoped policy uses; it
is proven at the unit ([`entitlements.spec.ts`](./apps/backend/src/modules/identity/entitlements.spec.ts))
and integration layers (permission from one membership is not exercisable in
another's branch; an inactive membership contributes neither permission nor
branch access).

### Database-backed resolver

[`DatabaseAuthorizationContextResolver`](./apps/backend/src/modules/identity/database-authorization-context.resolver.ts)
implements the Phase 4 `AuthorizationContextResolver` and is bound to
`AUTHORIZATION_CONTEXT_RESOLVER` in the app module (a local override that wins
over the authorization module's default for the global guard). It builds the
context purely from trusted state — verified principal, validated company,
database profile/membership/role — and **fails closed** (`null` → `403`).
Database failures propagate as a dependency error (`503`), never as a denial.

### Tenant isolation

The backend uses its trusted connection, which bypasses RLS, so every
membership query is explicitly scoped by `company_id`; cross-company reads
return nothing (`403`/`404`). RLS remains enabled as defense in depth and is
covered by an integration test that queries under the `authenticated` role.

### Never logged

Identity paths log sanitized events only (event name, request id, coarse reason,
and counts) — never tokens, permission sets, role values, or profile fields.

## Branches & Staff (Phase 6)

Phase 6 is the first operational-organization slice: company **branches** and
**staff members**. It follows the implementation guide
(`18-backend-implementation-guide.md`), which scopes Phase 6 to exactly these
two modules — fleet, routes, and trips are later, separate phases. It reads and
writes the existing `branches` and `staff_members` tables only; **no migrations
were needed**.

### Endpoints

All are nested under the tenant company (`:companyId`), matching the Phase 5
convention. The global authorization guard resolves the caller's context for the
company and enforces the declared permission before any handler runs.

| Method & path                                                               | Permission        | Notes                                                       |
| --------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------- |
| `GET /api/v1/companies/:companyId/branches`                                 | `branches.read`   | Paginated; **branch-scoped** visibility (see below).        |
| `GET /api/v1/companies/:companyId/branches/:branchId`                       | `branches.read`   | `404` when not in the company or not visible to the caller. |
| `POST /api/v1/companies/:companyId/branches`                                | `branches.manage` | Create; `409` on duplicate names / invalid city.            |
| `PATCH /api/v1/companies/:companyId/branches/:branchId`                     | `branches.manage` | Update descriptive fields only.                             |
| `POST /api/v1/companies/:companyId/branches/:branchId/activate`             | `branches.manage` | Activation transition.                                      |
| `POST /api/v1/companies/:companyId/branches/:branchId/deactivate`           | `branches.manage` | Deactivation transition.                                    |
| `GET /api/v1/companies/:companyId/staff-members`                            | `staff.read`      | Paginated; **company-scoped**.                              |
| `GET /api/v1/companies/:companyId/staff-members/:staffMemberId`             | `staff.read`      | `404` when not in the company.                              |
| `POST /api/v1/companies/:companyId/staff-members`                           | `staff.manage`    | Create (`DRIVER`/`ASSISTANT`).                              |
| `PATCH /api/v1/companies/:companyId/staff-members/:staffMemberId`           | `staff.manage`    | Update fields only.                                         |
| `POST /api/v1/companies/:companyId/staff-members/:staffMemberId/activate`   | `staff.manage`    | Activation transition.                                      |
| `POST /api/v1/companies/:companyId/staff-members/:staffMemberId/deactivate` | `staff.manage`    | Deactivation transition.                                    |

### Tenant isolation

The backend connects on its trusted, RLS-bypassing role, so **every** repository
query is scoped by `company_id` in SQL — a branch or staff id alone is never
sufficient (`WHERE id = $1 AND company_id = $2`, never a global fetch then an
app-side company compare). Soft-deleted rows (`deleted_at`) are excluded. A
resource addressed under the wrong company is reported as `404`, never
distinguishing "another company" from "does not exist". RLS remains enabled as
defense in depth and is covered by integration tests that query under the
non-bypassing `authenticated` role.

### Branch-scoped read authorization (no permission/branch cross-product)

Reading branches is **branch-scoped** — it mirrors the database
`branches_tenant_read` policy (`private.has_branch_access`): a company-wide
member (manager/super-admin) reads every branch, while a branch-restricted
member reads only the branch their membership is scoped to. This decision goes
through the Phase 5 per-membership **entitlements**
([`branch-access.policy.ts`](./apps/backend/src/modules/branches/branch-access.policy.ts)),
never the flat `permissions × branchAccess` union: `branches.read` is only ever
paired with a branch the _same_ membership reaches, so the Phase 5 cross-product
defect cannot reappear. Branch _management_ (`branches.manage`) is a company-wide
permission held only by managers/super-admins, so there is no branch-scoped
_write_ in Phase 6; staff are company-scoped end to end (`staff.read` is
`has_company_access`, `staff.manage` is company-wide). The coupling is proven at
the unit (including a synthetic cross-product construction on the real policy),
integration (RLS + service), and E2E (an employee cannot read a sibling branch)
layers.

### State transitions

Branches and staff carry a boolean `is_active` (there is no status enum in Phase
6 — the `buses`/`trips` state machines belong to later phases). Activation is a
**dedicated transition**, never a generic PATCH field: `activate`/`deactivate`
flip `is_active` atomically in a single conditional `UPDATE` (`... AND is_active
= NOT $target`), so a redundant transition changes no row and is reported as
`409` while a missing resource is `404` — no read-then-write race.

### Error semantics

`400` malformed request · `401` unauthenticated · `403` no active membership or
missing permission · `404` company-scoped resource absent or not safely visible ·
`409` duplicate name / invalid city reference / redundant activation ·
`503 DEPENDENCY_FAILURE` real database outage (never converted to `403`/`404`).
Malformed identifiers are validated before reaching PostgreSQL, so they fail
closed rather than surfacing as `22P02` → `500`. Bodies never leak SQL,
constraint names, stack traces, or cross-company existence.

### Deferred to later phases

Cities/stations, seat layouts and fleet/buses arrive in Phase 7 (below); routes
and pricing, and trips (with their `trip_status` state machine and scheduling
rules) follow in later phases. Branch/staff audit coverage remains deferred, but
the Phase 15 append-only audit platform is available for implemented operational
and financial actions.

## Cities, Stations, Seat Layouts & Fleet (Phase 7)

Phase 7 is the transport-catalog and fleet-foundation slice. It follows the
implementation guide (`18-backend-implementation-guide.md`), reading and writing
only the existing `cities`, `stations`, `seat_layouts` and `buses` tables —
**no migrations were needed** (the schema, including `buses.current_odometer_km`
and `buses.version` added in the production-hardening migration, already
enforces every documented invariant). The **`maintenance`** module that the guide
also lists under this phase is deferred (see below), keeping the phase to the
four catalog/fleet modules.

### Ownership model (grounded in the schema + RLS)

- **Cities, stations and seat layouts are global reference/template data**, not
  tenant-owned. Their RLS read policies admit _any authenticated user_
  (`cities_read_active`, `stations_read_active`, `seat_layouts_read`), and there
  is **no `cities.*`/`stations.*`/`seat-layouts.*` permission** in the Phase 4
  catalog and no tenant column on the tables. They are therefore exposed as
  **read-only** catalog endpoints (authenticated, no permission required).
- **Buses are company-owned.** Every bus query is scoped by `company_id`; buses
  reference a _global_ seat layout (`seat_layout_id`) and carry **no branch
  column**, so all fleet authorization is company-scoped `fleet.*` — there is no
  branch dimension in Phase 7 and thus no permission/branch cross-product to
  guard (the Phase 5 entitlement machinery is untouched and still active).

### Endpoints

| Method & path                                               | Permission        | Notes                                                       |
| ----------------------------------------------------------- | ----------------- | ----------------------------------------------------------- |
| `GET /api/v1/cities`                                        | _(authenticated)_ | Paginated; active cities only, stable id order.             |
| `GET /api/v1/cities/:cityId`                                | _(authenticated)_ | `404` when absent/inactive.                                 |
| `GET /api/v1/stations`                                      | _(authenticated)_ | Paginated; active + non-deleted; optional `?cityId` filter. |
| `GET /api/v1/stations/:stationId`                           | _(authenticated)_ | `404` when absent/inactive/deleted.                         |
| `GET /api/v1/seat-layouts`                                  | _(authenticated)_ | Paginated; global templates; exposes canonical seat labels. |
| `GET /api/v1/seat-layouts/:seatLayoutId`                    | _(authenticated)_ | `404` when absent.                                          |
| `GET /api/v1/companies/:companyId/buses`                    | `fleet.read`      | Paginated; **company-scoped**.                              |
| `GET /api/v1/companies/:companyId/buses/:busId`             | `fleet.read`      | `404` when not in the company.                              |
| `POST /api/v1/companies/:companyId/buses`                   | `fleet.manage`    | Create; `409` on duplicate plate / missing seat layout.     |
| `PATCH /api/v1/companies/:companyId/buses/:busId`           | `fleet.manage`    | Update descriptive fields + odometer; bumps `version`.      |
| `POST /api/v1/companies/:companyId/buses/:busId/activate`   | `fleet.manage`    | Activation transition.                                      |
| `POST /api/v1/companies/:companyId/buses/:busId/deactivate` | `fleet.manage`    | Deactivation transition.                                    |

### Tenant isolation (buses)

Repository signatures make the tenant context unavoidable
(`findInCompany(companyId, busId)`, `update(companyId, busId, …)`), and every
statement filters by `company_id` in SQL with `deleted_at IS NULL` — a bus id
alone is never sufficient, and counts are company-filtered before counting. A
bus addressed under the wrong company is `404`. RLS (`buses_tenant_read` =
`has_company_access`) remains enabled as defense in depth and is covered by an
integration test that queries under the non-bypassing `authenticated` role.

### Seat layouts & capacity

A seat layout is a **single row**: its seats are the canonical seat-number
strings stored inside the `layout_grid` jsonb (an array, or an object under
`seat_numbers`) — there is **no separate seat table**, so creating/replacing a
layout would be one atomic statement and needs no transaction. Capacity lives on
the layout (`total_seats`), not the bus; the database `validate_seat_layout`
trigger enforces `count(seat_numbers) == total_seats`, distinct labels, and label
shape. The API extracts and exposes the labels via a helper mirroring the
database `seat_layout_numbers` function.

### Bus state, odometer & version

Buses carry both a boolean `is_active` and an operational `status`
(`bus_status_enum`). **`status` transitions are maintenance-driven** (opening a
maintenance record → `IN_MAINTENANCE`, closing it restores it — business rules
§3); since the maintenance module is deferred, `status` is **not** mutated
through the fleet endpoints (a new bus defaults to `ACTIVE`) rather than
inventing an undocumented transition matrix. `is_active` uses **dedicated
`activate`/`deactivate` transitions** (atomic conditional `UPDATE`; redundant
transition → `409`, missing bus → `404`; no read-then-write). `current_odometer_km`
is validated as **non-negative only** — the schema documents `>= 0`
(`ck_buses_current_odometer`) and **no non-decreasing rule is documented**, so
none is invented. Every bus mutation increments `version` (optimistic-concurrency
column) atomically in the same statement.

### Error semantics

`400` malformed request · `401` unauthenticated · `403` no active membership or
missing `fleet.*` permission · `404` company-scoped bus (or reference row) absent
or safely hidden · `409` duplicate plate / missing seat-layout reference /
redundant activation · `422` database check-constraint failure (e.g. negative
odometer, defense in depth) · `503 DEPENDENCY_FAILURE` real database outage
(never converted to `403`/`404`). Malformed identifiers are validated before
reaching PostgreSQL. Bodies never leak SQL, constraint names, stack traces, or
cross-company existence.

### Deferred to later phases

- **Writes to global reference data** (`POST /stations`, `POST /seat-layouts`,
  city management) — the guide lists them as _suggested_, but the Phase 4
  permission catalog has no reference-data-management permission and the tables
  have no tenant scope, so implementing them would require fabricating a
  permission or letting tenant roles mutate globally-shared data. Deferred
  pending a platform-admin authorization model.
- The **`maintenance`** module and maintenance-driven bus `status` transitions.
- Routes and pricing (Phase 8) and trips (Phase 9) arrive below; bookings, seat
  reservations/locks/holds, tickets and payments remain Phase 10+.

## Routes, Pricing & Trips (Phases 8 + 9)

Phases 8 (routes & pricing) and 9 (trips) are combined in one branch because
trips depend directly on routes, pricing and fleet. They stay internally
separated: a **routes** module hosting two distinct components (routes CRUD and
append-only **route pricing**), and a **trips** module hosting **trips** plus the
append-only **trip events** log. Each component has its own service, repository
port, Postgres adapter, and domain types.

### Endpoints

| Method & path                                                                       | Permission                      | Notes                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| `GET/POST /api/v1/companies/:companyId/routes`                                      | `routes.read` / `routes.manage` | Company-scoped; create validates active stations + seeds initial price. |
| `GET/PATCH /api/v1/companies/:companyId/routes/:routeId`                            | `routes.read` / `routes.manage` | `404` cross-company; `422` invalid stations.                            |
| `POST /api/v1/companies/:companyId/routes/:routeId/activate` \| `/deactivate`       | `routes.manage`                 | `is_active` transition (`409` redundant).                               |
| `GET /api/v1/companies/:companyId/routes/:routeId/price-history`                    | `routes.read`                   | Newest period first.                                                    |
| `POST /api/v1/companies/:companyId/routes/:routeId/prices`                          | `routes.manage`                 | Appends a price (no dedicated pricing permission exists).               |
| `GET/POST /api/v1/companies/:companyId/trips`                                       | `trips.read` / `trips.manage`   | Company-scoped scheduling.                                              |
| `GET/PATCH /api/v1/companies/:companyId/trips/:tripId`                              | `trips.read` / `trips.manage`   | Edit only while `SCHEDULED`; optimistic-locked.                         |
| `POST /api/v1/companies/:companyId/trips/:tripId/start` \| `/complete` \| `/cancel` | `trips.manage`                  | Lifecycle transitions.                                                  |
| `GET /api/v1/companies/:companyId/trips/:tripId/events`                             | `trips.read`                    | Append-only lifecycle log.                                              |

### Route ownership & pricing history

Routes are company-scoped (`WHERE id = $1 AND company_id = $2`, composite unique
`(company, origin, destination)`) over the **global** station catalog; origin and
destination must be distinct, existing, active stations (`422` otherwise).
Pricing is an **append-only history** (`route_price_history`) with a gist
exclusion constraint (no overlapping periods) and a partial unique index (exactly
one open period). A price change runs in one transaction that captures **one**
boundary instant: the close stamps the old period's `effective_to` at
`clock_timestamp()` and returns it, and the new period opens `effective_from`
from that exact value — so `old.effective_to === new.effective_from` (no gap, no
overlap; verified in an integration test). It also mirrors the new price onto
`routes.default_price_mru` in the same transaction — never a destructive
overwrite, and a mid-change failure rolls back both the history and the mirror.
Route creation seeds the initial open period atomically. Under concurrency the
partial-unique index guarantees exactly one open period always survives (never
zero, never two). The history table has no `company_id`; ownership is always
verified through the parent route first.

### Trip ownership, associations & scheduling

Trips are company-scoped (**no branch column** → `trips.manage` is company-wide,
proven from the permission matrix; the Phase 5 branch-entitlement machinery is
untouched). Composite foreign keys enforce **same-company** route/bus/driver/
assistant at the database. Creation runs in a transaction that validates, with
company-scoped in-transaction reads: the route (exists in company, active) and
bus (active & `status = ACTIVE`); and the **driver/assistant** — same company,
**not soft-deleted**, active, and of the exact type (`DRIVER`/`ASSISTANT`). That
staff check is stricter than the database staff-type trigger (which ignores
`deleted_at`) and yields a precise `422`. It then snapshots the route price onto
the trip, computes `boarding_closes_at` from
`company_settings.boarding_close_minutes` (default 30), inserts the trip, and
appends a `TRIP_CREATED` event. A trip price snapshot means later route-price
changes never alter a scheduled trip.

**Bus schedule conflicts** are prevented by a new forward-only migration
(`014`) adding a gist exclusion constraint
`EXCLUDE (bus_id WITH =, tstzrange(departure, arrival, '[)') WITH &&) WHERE (is_active AND status <> 'CANCELLED')`
— so live operational trips (`SCHEDULED`/`ONGOING`/`COMPLETED`) block overlaps,
while a **cancelled** trip or a soft-removed trip (`is_active = false`; trips have
no `deleted_at`, so `is_active` is their removal flag) **releases** its window.
Concurrency-safe at the database (proven by a two-connection integration test:
of two overlapping assignments, exactly one commits; and by cancelling a trip and
re-scheduling in the freed window). The maintenance-overlap check (business rules
§3) is deferred because the maintenance module is not yet implemented.

### Lifecycle, optimistic locking & events

The centralized transition matrix (`trip-transitions.ts`) is derived from doc 18's
three lifecycle endpoints + `trip_status_enum`: `SCHEDULED → ONGOING` (start,
stamps actual departure, event `DEPARTED`), `ONGOING → COMPLETED` (complete,
stamps actual arrival, event `ARRIVED`), `SCHEDULED → CANCELLED` (cancel, event
`CANCELLED`). `COMPLETED`/`CANCELLED` are terminal; an action from a wrong state
is `409`, a missing/wrong-company trip is `404`. Transitions are atomic
(conditional on current status) and bump `version`; each also appends its event
in the same transaction. **`BOARDING` is intentionally not reachable in Phase 9**:
the enum defines it (with `BOARDING_OPENED`/`BOARDING_CLOSED` events) for the
later boarding/ticketing phase, and doc 18 documents no boarding action — so no
transition enters it, and (to avoid referencing an unreachable state) no action
lists it as a source either. Edits (`PATCH`) require `expectedVersion` — a
mismatch is `409` —
apply only while `SCHEDULED`, and recompute the boarding time when the departure
moves. Actual times are server-controlled. `trip_events` are immutable (a trigger
blocks update/delete) and exposed read-only.

### Error semantics & tenant isolation

`400` malformed · `401` unauthenticated · `403` missing tenant permission · `404`
scoped resource absent/hidden · `409` duplicate / schedule overlap / stale version
/ invalid transition (SQLSTATE `23P01` exclusion violations are now mapped to
`409`) · `422` domain-invariant violation (inactive station/route/bus, invalid
times/staff) · `503 DEPENDENCY_FAILURE` real outage. Every repository method
takes an explicit executor and `companyId`; counts are company-filtered; RLS
(`routes_tenant_read`, `route_prices_tenant_read`, `trips_tenant_read`,
`trip_events_tenant_read`) is verified under the non-bypassing `authenticated`
role. Malformed ids fail closed before PostgreSQL.

## Phase 10–11: Availability and booking engine

Public discovery is implemented through `GET /trips/search`,
`GET /trips/:tripId/availability`, and
`GET /trips/:tripId/price-preview`. Search and preview use the scheduled trip's
price snapshot; preview accepts a bounded passenger count and remains an estimate.
Availability is read-only and privacy-safe: each seat exposes only its canonical
id/label, semantic status, and the assigned booking passenger's advisory gender.

Passenger and company booking APIs are implemented under `/bookings` and
`/companies/:companyId/bookings`. Creation is one PostgreSQL transaction covering
durable scoped idempotency, booking/passenger/seat rows, immutable price and
cancellation-policy snapshots, and the initial append-only event. PostgreSQL's
active-seat unique index is the final double-booking boundary. Company operations
use permission/branch grants from the same membership entitlement; online-owner
operations require both the authenticated owner and a `WEB`/`MOBILE_APP` channel.

Doc 18 labels `GET/POST /passengers` as suggested endpoints, but the authoritative
schema defines `passengers` as required children of a booking rather than reusable
profiles. Passenger creation therefore occurs only inside the atomic booking
transaction; standalone passenger CRUD is intentionally not exposed.

`cancellation_policy_snapshot` is persisted and immutable, but its JSON keys and
evaluation semantics are not defined by the architecture. Phase 11 therefore
cancels only unpaid `HELD`/`PENDING_PAYMENT` bookings and does not invent refund
deadlines or percentages. Confirmed cancellation remains deferred with refunds.
Agent creation likewise creates a hold; cash confirmation, payments, tickets/QR,
refunds, commissions, notifications, check-in/boarding, reports, analytics, and
frontend/mobile implementation remain Phase 12+ work.

## Phase 12–13: Payments and tickets

### Payments

Payment APIs live under `/payments` (passenger owner), `/companies/:companyId/payments`
(staff), and the public `/webhooks/payments/:provider`. The `payments` table,
its RLS read policy, no-delete guard, `updated_at` trigger and the
amount/currency snapshot check already exist from the base schema; migration
`016_payments_tickets_engine` adds the lifecycle invariants as database triggers
(defense in depth, since the backend role bypasses RLS) and a payment-scoped
`idempotency_records.payment_id` pointer.

**Authoritative amount/currency.** A client never supplies the total. Initiation
locks the booking (`FOR UPDATE`), derives `amount`/`currency` from the immutable
booking snapshot in the same `INSERT`, and `public.validate_payment_booking`
re-checks them at the row level.

**State machine** (`architecture/09-payment-state-machine.md`), enforced both in
the application (`payment-transitions.ts`) and by the `enforce_payment_transition`
trigger:

```
PENDING    -> PROCESSING | SUCCEEDED | CANCELLED
PROCESSING -> SUCCEEDED  | FAILED    | CANCELLED
SUCCEEDED  -> REFUNDED            (full refund only)
FAILED, CANCELLED, REFUNDED       terminal
```

Illegal transitions are a `409` in the app (conditional `WHERE status = <from>`
updates) and a backstop trigger error at the row. Payment identity/amount are
immutable and `provider_reference` is write-once. A failed attempt is never
reused — a retry is a new payment row (`Booking 1:N Payments`).

**Provider abstraction.** Online settlement goes through a provider-neutral
`PaymentProvider` port. Registration is controlled by `PAYMENTS_PROVIDER_MODE`
(`disabled` | `test`): **production defaults to `disabled`** — no adapter is
registered and every payment mutation (initiation, confirmation, refund, webhook)
fails safely with `503 PAYMENT_PROVIDER_UNAVAILABLE` before touching state, and
`test` is rejected by production config validation, and disabled mode requires no
payment secret. Non-production defaults to `test`, wiring only the deterministic
in-process adapter (HMAC-SHA256 over the raw webhook body, verified in constant
time); test mode **requires** an explicit `PAYMENTS_TEST_WEBHOOK_SECRET` (no
random/ephemeral fallback and no runtime default — missing/blank/placeholder/short
fails startup), which automated suites supply via `test/setup-test-secret.ts` and
local developers should set to a unique local-only value. Real Bankily/Masrvi/Seddad adapters and
their real secrets are **deferred** until their signature/payload contracts are
documented, so **real production payments remain BLOCKED** pending that work — an
honest external/business integration blocker, not an infrastructure gap. The port
exposes only normalized internal concepts, so raw provider payloads never reach
the domain.
CASH is confirmed in person by staff (`payments.confirm`); the confirmation and
webhook success paths both drive the booking to `CONFIRMED` and its `HELD` seats
to `CONFIRMED`, write `PAYMENT_CONFIRMED`, and are guarded against double
settlement by the partial unique index `uq_successful_payment_per_booking`.

**Idempotency & webhook dedup.** Initiation uses durable DB-backed idempotency
under a distinct `CREATE_PAYMENT` operation scope with a canonical, hashed
request fingerprint. Webhooks are deduplicated exactly as the docs specify —
terminal-state no-op plus the partial unique index `uq_payment_provider_ref`
`(method, provider_reference)`; **no separate provider-events table is required
or invented.** Verified against real PostgreSQL: repeated delivery, two
simultaneous deliveries, and out-of-order success/failure all settle once; a
wrong amount/currency/reference never mutates state; an unverified signature is a
`400` with no mutation. A payment is never marked successful from an unverified
payload.

**Refund scope.** Full refund only (`SUCCEEDED -> REFUNDED`, amount derived from
the captured payment), writing `REFUND_CREATED`/`REFUND_COMPLETED` booking
events. Concurrent refunds complete once. **Partial refunds are deferred:** the
schema has no `refunded_amount` model and partial/cancellation formulas are not
documented, so `PARTIALLY_REFUNDED` is intentionally unreachable in both the app
matrix and the trigger (the enum value is retained for future compatibility).

### Tickets

Ticket APIs live under `/bookings/:bookingId/tickets` and `/tickets/:ticketId`
(passenger owner) and `/companies/:companyId/…` (staff: issue, read, verify,
validate, revoke). There is no `ticket_status` enum: lifecycle is derived from
`issued_at` / `checked_in_at` / `cancelled_at`, and `enforce_ticket_lifecycle`
makes the issuance snapshot (including the QR hash) immutable with the two
terminal timestamps write-once and mutually exclusive.

**Issuance** requires a `CONFIRMED`, paid booking (a `SUCCEEDED` payment); it
issues one ticket per passenger/confirmed-seat, idempotently — the unique
constraints `uq_ticket_booking_passenger` / `uq_ticket_seat` make concurrent or
repeated issuance produce exactly one ticket per relation. **QR tokens** are
256-bit random values; only `sha256(token)` is stored in `qr_token_hash`, and the
raw token is returned exactly once at issuance (never re-derivable, never logged,
never in events). Verified against PostgreSQL: the raw token appears in no
column. Validation (`/tickets/:id/validate`) checks in a ticket once (duplicate
scans are a `409`), sets the seat to `CHECKED_IN`, and writes a `CHECKED_IN`
event; verify is read-only and reports a refunded booking as invalid.

### Scoping, RLS and exclusions

Every payment/ticket query is explicitly scoped in SQL by passenger ownership
(`booked_by_user_id` + `WEB`/`MOBILE_APP` channel) or by company + the _same
membership's_ branch entitlement — permissions are never unioned across
memberships. The one deliberately unscoped read is the signature-verified webhook
lookup by unique `internal_reference`. RLS remains defense in depth: direct
`authenticated` writes to `payments`/`tickets` are denied (`42501`) and
`qr_token_hash` is never exposed by a DTO.

### Maintenance & commissions

Maintenance records are tenant-scoped at `GET`/`POST`
`/api/v1/maintenance-records` and `PATCH /api/v1/maintenance-records/:recordId`.
`X-Company-Id` selects the authorized tenant. A record begins `SCHEDULED` with a
required half-open `[started_at, scheduled_ends_at)` window, then may only move
to `IN_PROGRESS` or `CANCELLED`; in-progress work may only move to `COMPLETED`
or `CANCELLED`. There is no reopening or generic status PATCH. One bus can have
only one scheduled/in-progress record, and the database plus a shared bus-row
lock prevents races with trip assignment. Starting work marks the bus
`IN_MAINTENANCE`; closing restores `ACTIVE` only when no other active maintenance
exists and never overwrites `OUT_OF_SERVICE` or `ARCHIVED`. Maintenance does not
cancel trips or passenger bookings.

`GET /api/v1/agent-commission-transactions` requires `commissions.read` and
`X-Company-Id`. Managers read their company; agents read only transactions tied
to their own active AGENT membership. A commission is created only after the
database confirms an agent-created booking is `CONFIRMED`: its immutable snapshot
uses `company_memberships.commission_rate`, `bookings.total_amount`,
`round(base * rate / 100, 2)`, and the booking currency. The unique
`(agent_membership_id, booking_id)` key makes settlement/webhook retries create
at most one row. Financial identity, rate, basis, amount, currency, and creation
time are immutable; lifecycle is limited to the documented `PENDING -> EARNED |
CANCELLED` and `EARNED -> PAID | CANCELLED` transitions.

Full refunds remain `SUCCEEDED -> REFUNDED` only. Cancellation/refund handling
cancels `PENDING`/`EARNED` commission records only after authoritative database
state is verified. A `PAID` commission is never changed, reversed, or paid out
again: clawback and manual settlement are deliberately deferred, with no payout
provider, settlement endpoint, negative adjustment, or partial-refund model.

### Audit & observability

`GET /api/v1/audit-logs` requires `audit.read` and `X-Company-Id`, is paginated,
and returns a tenant-scoped allowlist. `audit_logs` is append-only at PostgreSQL
level: neither updates nor deletes are allowed, and authenticated clients cannot
insert rows. The transaction writer records curated maintenance and payment /
commission state changes. It accepts only allowlisted JSON metadata and excludes
passwords, tokens, authorization/cookie data, provider/webhook secrets,
idempotency keys, QR material, card data, documents, phone numbers, passenger
PII, and SQL parameters. Request/correlation values are persisted only when
valid UUIDs; non-UUID request IDs remain available in structured logs but are
stored as `NULL` in audit rows.

Structured Pino logging retains request/correlation context and redacts secrets;
slow HTTP requests emit a sanitized `slow_request` event controlled by
`LOG_SLOW_REQUEST_MS`. `/api/v1/health/live` and `/api/v1/health/ready` retain
their existing process and database-readiness semantics. No metrics backend,
external monitoring vendor, retention policy, or alert threshold is introduced.

Explicitly **not** implemented: notifications, reports/analytics, partial
refunds, commission clawbacks/settlements, payout providers, QR image/PDF
rendering, and boarding-device APIs beyond the documented `validate` operation.

## Phase 16–17: API hardening and quality gate

### API hardening (Phase 16)

- **Public-route allowlist.** Exactly six routes opt out of authentication:
  `health/live`, `health/ready`, `trips/search`, `trips/:tripId/availability`,
  `trips/:tripId/price-preview`, and the signature-verified
  `webhooks/payments/:provider`. A reflection-based guardrail test
  (`route-security-guardrails.integration-spec.ts`) fails the build if any other
  route becomes public, if a permission decorator references a permission absent
  from the central catalog, or if a write route is neither permission-gated nor a
  documented ownership route.
- **Per-category rate limits.** A global throttler (`RATE_LIMIT_LIMIT` /
  `RATE_LIMIT_TTL`) plus configuration-driven category overrides for public
  reads, authenticated reads, writes, booking creation, payment initiation,
  payment confirmation, refunds, provider webhooks, ticket verification, ticket
  validation and audit reads (`RATE_LIMIT_*` env vars). No production limits are
  invented — categories default to the global limit and are tightened by env.
  The `IdentityThrottlerGuard` keys buckets on a hash of the bearer token when
  present (so users never share a bucket) and otherwise on `req.ip` (spoofed
  `X-Forwarded-For` cannot bypass because `trust proxy` is off by default). `429`
  responses use the stable `RATE_LIMIT_EXCEEDED` envelope and leak no key.
- **`Cache-Control: no-store`** on every API response — the API serves per-user,
  tenant-scoped and financial data; no public caching policy is invented.
- **Payload limits.** JSON/urlencoded bodies are bounded by `BODY_LIMIT`;
  oversized bodies return a stable `413 PAYLOAD_TOO_LARGE` and malformed JSON a
  `400` (body-parser errors are mapped in the global filter, not leaked as 500s).
  The raw webhook body remains available for signature verification.
- **Error sanitization.** The global filter maps every failure to a stable code;
  unknown errors become a generic 500. No stack, SQL, constraint name, provider
  payload or cross-tenant existence is exposed.
- **Secret and log redaction.** Structured request/response logs use an allowlist
  serializer (id, correlationId, method, path, status) and remove
  `authorization`/`cookie`/`set-cookie` headers; the request URL is logged
  path-only so query-string tokens are never written. Bodies, arbitrary headers,
  QR tokens, fingerprints and passenger PII are never logged.
- **Webhook replay protection** (unchanged from Phase 12): verify signature
  before trusting the payload; terminal-state + `uq_payment_provider_ref`
  idempotency; wrong amount/currency/reference never settles; rate limiting is
  defense-in-depth only, never the replay control.
- **CORS.** Explicit allowlist passed verbatim to the `cors` library (exact
  matching); production denies all origins when unset (no wildcard fallback);
  never a literal `*`; `Authorization` and `Idempotency-Key` are allowlisted.
- **Swagger/OpenAPI.** Configuration-gated, disabled in production by default; an
  OpenAPI security test generates the real document and asserts bearer auth is
  documented, the Idempotency-Key header is present, and no `qr_token_hash`,
  password hash, fingerprint, signature header or provider secret appears.

### Quality gate (Phase 17)

- **Forward-only Prettier gate** (`pnpm format:check`). Checks only files this
  branch adds/changes (committed vs merge-base with `main`, plus staged, unstaged
  and untracked non-ignored files, deduplicated, NUL-safe). ~200 pre-existing
  files do not yet satisfy the Prettier config; **full-repo normalization is
  deferred to a separate formatting-only PR**. `pnpm lint` (ESLint,
  `--max-warnings 0`) remains the enforced whole-repo style gate.
- **Architecture guardrails** — controllers import no database layer and contain
  no SQL; guards touch no domain tables; providers stay behind ports; tickets are
  independent of the concrete payment provider; no in-memory repo in production;
  no Phase-18 deployment code.
- **Migration-history guardrail** — migrations 001–017 are unchanged by this
  branch, uniquely numbered/timestamped and ordered, security-definer functions
  pin an empty `search_path`, and no migration 018 exists.
- **Secret scanner** (`pnpm security:secrets`). Deterministic offline scan of
  tracked files; reports only file/line/rule (never the value); detects private
  keys, cloud access keys, provider/CI tokens and credentialed remote DB URLs;
  local (single-label / 127.0.0.1) DB URLs are treated as documented fixtures.
- **Dependency audit** (`pnpm security:audit` → `pnpm audit --prod
--audit-level high`). Fails on HIGH. Two HIGH transitive advisories (lodash
  `_.template`, js-yaml merge-key) were **remediated by upgrading the direct
  dependency `@nestjs/swagger` from ^8.1.0 to ^11.4.6** (the NestJS-11-aligned
  major, which vendors patched lodash/js-yaml). Audit now reports no known
  vulnerabilities; no advisory is suppressed and the threshold is not lowered.
- **CI quality gate** — `.github/workflows/backend-quality-gate.yml`: PR + push to
  `main`, `permissions: contents: read`, concurrency-cancel, 30-minute timeout,
  pinned Node 22 / pnpm 11.9.0 / **Supabase CLI 2.109.1**, frozen lockfile,
  isolated in-runner Supabase, and every gate (format, lint, typecheck, unit,
  integration, e2e, build, `supabase db reset`, pgTAP, secret scan, dependency
  audit). No deployment or publishing. The workflow is statically validated; a
  real GitHub Actions run still requires a Pull Request.

### Consolidated security test matrices (Phase 17)

Four table-driven matrices consolidate the security guarantees, backed by typed
fixtures under `test/support/factories/`:

- **Consolidated RLS matrix** (`test/integration/rls-matrix.integration-spec.ts`)
  — one deterministic two-tenant graph seeded on a pinned connection inside a
  rolled-back transaction, asserted against the real non-bypassing `authenticated`
  / `anon` roles across all **19 tenant-owned tables** (**152 RLS assertions**):
  anonymous denial, owner/company/branch reads, wrong-tenant / wrong-branch /
  inactive-membership / unrelated-user denial, and direct INSERT/UPDATE/DELETE
  refusal. Documented exceptions: profiles self-read/update, own-membership read,
  owning-agent commission read.
- **Repository SQL-scope matrix** (`src/tooling/repository-sql-scope.spec.ts`) —
  proves every tenant-owned repository filters by an explicit parameterized
  `company_id` / owner / branch predicate (the backend role may bypass RLS), and
  that no repository concatenates a request value into SQL (every `${…}` is a
  static identifier or `$n` placeholder).
- **Abuse & malformed-input matrix**
  (`src/common/validation/abuse-input-matrix.spec.ts`) — routes privileged-field
  mass-assignment, malformed ids/uuids/enums/primitives and SQL-injection strings
  through the real global validation policy; **plus a header/parser abuse e2e**
  (`test/abuse-headers.e2e-spec.ts`) and a real-PostgreSQL **SQL-injection matrix**
  (`test/integration/sql-injection.integration-spec.ts`) proving payloads stay
  data (structure unchanged, no cross-tenant leak, typed 22P02 on id casts).
- **Fourteen-journey manifest** (`test/support/journeys/journey-manifest.ts` +
  `test/journey-manifest.integration-spec.ts`) — a typed map of each critical
  journey to concrete e2e / integration / migration proofs, with a
  machine-checkable test that fails if a journey loses its e2e or required
  integration proof, an entry is removed, or a referenced test/migration is gone.

### Local verification vs remote

All gates above are run and pass locally except the remote GitHub Actions
execution, which cannot run without a push/PR.

## Phase 18.1: Production readiness (infrastructure)

Container-based, **provider-neutral** production setup. No cloud provisioning and
no deployment are included — those are Phase 18.2 / 18.3.

- **Container:** multi-stage [`Dockerfile`](./Dockerfile) — Node 22
  (`node:22.23.1-bookworm-slim`, pinned) + pnpm 11.9.0, frozen lockfile,
  `pnpm deploy` for a production-only `node_modules`. Runtime image (~86 MB) is
  non-root (`node`, uid 1000), exposes port 3000, uses an exec-form entrypoint,
  ships a liveness-based `HEALTHCHECK`, and contains only `dist` + prod deps
  (no `.env`, tests, `.git`, source, or local Supabase state — see
  [`.dockerignore`](./.dockerignore)). Migrations are **not** run at build or
  startup. Never publish/run `latest`.
- **Fail-fast production config:** `assertProductionConfig`
  (`apps/backend/src/config/production-config.validation.ts`) rejects unsafe
  production configuration before listening (missing/localhost `DATABASE_URL`,
  `sslmode=disable`, unresolved/non-https JWKS, `HS*`/`none` algorithms, empty or
  wildcard CORS, invalid body/rate/pool/timeout values, missing or placeholder
  webhook secret) with a secret-free, DB-URL-redacted error.
- **Lifecycle:** liveness is process-only (DB-independent); readiness runs a
  bounded DB probe and fails safe (`503`) with no leakage; graceful `SIGTERM`
  shutdown closes the pool.
- **Local smoke test:** [`scripts/smoke-container.sh`](./scripts/smoke-container.sh)
  builds the image and runs 15 checks against a **disposable local** database
  (non-root, fail-fast, liveness, readiness, route protection, Swagger-off,
  graceful shutdown, no secret in logs). It never uses a shared/production DB and
  never publishes the image.
- **Operations docs:** [`docs/operations/`](./docs/operations) — discovery
  report, provider-neutral deployment requirements + decision matrix (hosting
  platform is an **open decision**), and the production runbook.

Phase 18.2 (deploy/CD/registry/migration execution) and Phase 18.3 (cloud
provisioning/DNS/TLS/backups/monitoring) remain **not started**.
