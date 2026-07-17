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
GET /api/v1/health/live    -> liveness probe
GET /api/v1/health/ready   -> readiness probe
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
See [`.env.example`](./.env.example) for the full list. Auth variables remain
reserved for a later phase.

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
