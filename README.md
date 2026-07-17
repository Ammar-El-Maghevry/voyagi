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
