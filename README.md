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

- Node.js `>= 20` (repository developed on Node 26)
- pnpm `>= 11`

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
pnpm test:integration # integration tests (real PostgreSQL; skips when none reachable)
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
pnpm test:integration   # runs against DATABASE_URL, skips cleanly if unreachable
```

Integration tests are **non-destructive**: they use a session-scoped `TEMP`
table on a single pinned connection and leave no residue. They never touch the
real schema, run migrations, or seed data.

### Health readiness

`GET /api/v1/health/ready` runs a bounded `SELECT 1` and returns `200`
(`checks.database = "up"`) when the database is reachable, or `503`
(`DEPENDENCY_FAILURE`) when it is not. `GET /api/v1/health/live` is independent
of the database and never fails because of a database outage.

### Using the database in later phases

Feature modules obtain the abstractions by injection (the module is global):

```ts
import { DatabaseService, TransactionManager } from '../../infrastructure/database';

// Single query — always parameterized (never string-interpolate user input):
await this.database.query('SELECT id FROM trips WHERE company_id = $1', [companyId]);

// Atomic multi-statement work:
await this.transactions.run(async (tx) => {
  await tx.query('INSERT INTO bookings (...) VALUES ($1, ...)', [/* ... */]);
  await tx.query('INSERT INTO booking_events (...) VALUES ($1, ...)', [/* ... */]);
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
so in-flight queries can finish and connections are released cleanly.

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

| Method & path | Auth | Notes |
| --- | --- | --- |
| `GET /api/v1/profiles/me` | authenticated | The caller's profile; `404` if none. |
| `PATCH /api/v1/profiles/me` | authenticated | Updates `fullName` / `phoneNumber` only (the RLS-editable fields). |
| `GET /api/v1/profiles/me/companies` | authenticated | Paginated list of companies the caller actively belongs to. |
| `GET /api/v1/companies/:companyId/memberships` | `memberships.read` | Paginated, tenant-scoped list. |
| `GET /api/v1/companies/:companyId/memberships/:membershipId` | `memberships.read` | Single membership, scoped to the company. |

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
closed). An RLS *read* policy is never used to justify an unrelated write, and a
role value the application does not recognize is dropped and logged (count only),
never granted.

| Role | Permissions | Basis |
| --- | --- | --- |
| `SUPER_ADMIN` | whole catalog | `private.is_super_admin()` short-circuits every RLS predicate. |
| `COMPANY_MANAGER` | whole catalog | `private.can_manage_company()` + §7.2 ownership + manager business flows. |
| `BRANCH_EMPLOYEE` | the read set only | company-scoped RLS *read* policies; no documented write. |
| `AGENT` | read set **+** `bookings.create` | read policies + the agent as booking creator (`12-business-rules.md` §1). |
| `PASSENGER` | none | reaches own resources by ownership, never a company-scoped permission. |

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
across memberships. They are correct for *company-scoped* decisions, but must
**never be intersected** to make a *branch-scoped* one — that would form a
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
*endpoint* yet, so this is the mechanism a future branch-scoped policy uses; it
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

| Method & path | Permission | Notes |
| --- | --- | --- |
| `GET /api/v1/companies/:companyId/branches` | `branches.read` | Paginated; **branch-scoped** visibility (see below). |
| `GET /api/v1/companies/:companyId/branches/:branchId` | `branches.read` | `404` when not in the company or not visible to the caller. |
| `POST /api/v1/companies/:companyId/branches` | `branches.manage` | Create; `409` on duplicate names / invalid city. |
| `PATCH /api/v1/companies/:companyId/branches/:branchId` | `branches.manage` | Update descriptive fields only. |
| `POST /api/v1/companies/:companyId/branches/:branchId/activate` | `branches.manage` | Activation transition. |
| `POST /api/v1/companies/:companyId/branches/:branchId/deactivate` | `branches.manage` | Deactivation transition. |
| `GET /api/v1/companies/:companyId/staff-members` | `staff.read` | Paginated; **company-scoped**. |
| `GET /api/v1/companies/:companyId/staff-members/:staffMemberId` | `staff.read` | `404` when not in the company. |
| `POST /api/v1/companies/:companyId/staff-members` | `staff.manage` | Create (`DRIVER`/`ASSISTANT`). |
| `PATCH /api/v1/companies/:companyId/staff-members/:staffMemberId` | `staff.manage` | Update fields only. |
| `POST /api/v1/companies/:companyId/staff-members/:staffMemberId/activate` | `staff.manage` | Activation transition. |
| `POST /api/v1/companies/:companyId/staff-members/:staffMemberId/deactivate` | `staff.manage` | Deactivation transition. |

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
paired with a branch the *same* membership reaches, so the Phase 5 cross-product
defect cannot reappear. Branch *management* (`branches.manage`) is a company-wide
permission held only by managers/super-admins, so there is no branch-scoped
*write* in Phase 6; staff are company-scoped end to end (`staff.read` is
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
rules) follow in later phases. Audit-log writing for branch/staff changes is
deferred to the Audit phase — no audit infrastructure exists yet.

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
  tenant-owned. Their RLS read policies admit *any authenticated user*
  (`cities_read_active`, `stations_read_active`, `seat_layouts_read`), and there
  is **no `cities.*`/`stations.*`/`seat-layouts.*` permission** in the Phase 4
  catalog and no tenant column on the tables. They are therefore exposed as
  **read-only** catalog endpoints (authenticated, no permission required).
- **Buses are company-owned.** Every bus query is scoped by `company_id`; buses
  reference a *global* seat layout (`seat_layout_id`) and carry **no branch
  column**, so all fleet authorization is company-scoped `fleet.*` — there is no
  branch dimension in Phase 7 and thus no permission/branch cross-product to
  guard (the Phase 5 entitlement machinery is untouched and still active).

### Endpoints

| Method & path | Permission | Notes |
| --- | --- | --- |
| `GET /api/v1/cities` | *(authenticated)* | Paginated; active cities only, stable id order. |
| `GET /api/v1/cities/:cityId` | *(authenticated)* | `404` when absent/inactive. |
| `GET /api/v1/stations` | *(authenticated)* | Paginated; active + non-deleted; optional `?cityId` filter. |
| `GET /api/v1/stations/:stationId` | *(authenticated)* | `404` when absent/inactive/deleted. |
| `GET /api/v1/seat-layouts` | *(authenticated)* | Paginated; global templates; exposes canonical seat labels. |
| `GET /api/v1/seat-layouts/:seatLayoutId` | *(authenticated)* | `404` when absent. |
| `GET /api/v1/companies/:companyId/buses` | `fleet.read` | Paginated; **company-scoped**. |
| `GET /api/v1/companies/:companyId/buses/:busId` | `fleet.read` | `404` when not in the company. |
| `POST /api/v1/companies/:companyId/buses` | `fleet.manage` | Create; `409` on duplicate plate / missing seat layout. |
| `PATCH /api/v1/companies/:companyId/buses/:busId` | `fleet.manage` | Update descriptive fields + odometer; bumps `version`. |
| `POST /api/v1/companies/:companyId/buses/:busId/activate` | `fleet.manage` | Activation transition. |
| `POST /api/v1/companies/:companyId/buses/:busId/deactivate` | `fleet.manage` | Deactivation transition. |

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
  city management) — the guide lists them as *suggested*, but the Phase 4
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

| Method & path | Permission | Notes |
| --- | --- | --- |
| `GET/POST /api/v1/companies/:companyId/routes` | `routes.read` / `routes.manage` | Company-scoped; create validates active stations + seeds initial price. |
| `GET/PATCH /api/v1/companies/:companyId/routes/:routeId` | `routes.read` / `routes.manage` | `404` cross-company; `422` invalid stations. |
| `POST /api/v1/companies/:companyId/routes/:routeId/activate` \| `/deactivate` | `routes.manage` | `is_active` transition (`409` redundant). |
| `GET /api/v1/companies/:companyId/routes/:routeId/price-history` | `routes.read` | Newest period first. |
| `POST /api/v1/companies/:companyId/routes/:routeId/prices` | `routes.manage` | Appends a price (no dedicated pricing permission exists). |
| `GET/POST /api/v1/companies/:companyId/trips` | `trips.read` / `trips.manage` | Company-scoped scheduling. |
| `GET/PATCH /api/v1/companies/:companyId/trips/:tripId` | `trips.read` / `trips.manage` | Edit only while `SCHEDULED`; optimistic-locked. |
| `POST /api/v1/companies/:companyId/trips/:tripId/start` \| `/complete` \| `/cancel` | `trips.manage` | Lifecycle transitions. |
| `GET /api/v1/companies/:companyId/trips/:tripId/events` | `trips.read` | Append-only lifecycle log. |

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

### Deferred to Phase 10+

Passengers, availability, bookings, seat reservations/holds/locks, the
`GET /trips/:tripId/seats` seat-availability endpoint (doc 18 suggests it, but it
is seat-availability which depends on bookings), tickets, QR, payments, refunds,
and notifications.
