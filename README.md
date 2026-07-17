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
pnpm lint         # ESLint
pnpm typecheck    # tsc --noEmit
pnpm test         # unit tests (Jest)
pnpm test:e2e     # end-to-end tests (Jest + supertest)
pnpm build        # nest build
pnpm start:dev    # watch-mode dev server
```

## Configuration

Environment variables are typed, validated at startup and fail fast when invalid.
See [`.env.example`](./.env.example) for the full list. Only the Phase 1 variables
are read today; database/auth variables are reserved for later phases.
