# Voyagi Backend — Production Runbook (Phase 18.1)

Container-based, provider-neutral production readiness. **No real deployment has
occurred**; platform selection, CD pipelines, and production migration execution
are Phase 18.2 / 18.3.

## Runtime versions

- **Node 22** (image pins `node:22.23.1-bookworm-slim` by tag **and** digest).
  pnpm **11.9.0**.
- `engines.node` is `>=22.13.0` (root + backend), matching the toolchain floor.

## Build & start (without Docker)

```bash
pnpm install --frozen-lockfile
pnpm --filter @voyagi/backend run build   # -> apps/backend/dist
node apps/backend/dist/main.js            # production start (NODE_ENV=production)
```

## Docker

```bash
# Build (from repo root; the monorepo is the build context):
docker build -t voyagi-backend:<version> -f Dockerfile .
# Never tag or run as `latest`; use an immutable version tag.
```

- **Architecture:** multi-stage. Build stage installs the frozen workspace,
  compiles the backend, and `pnpm deploy --prod` flattens a production-only
  `node_modules`. Runtime stage copies only `node_modules`, `package.json` and
  `dist`.
- **Base/final image:** `node:22.23.1-bookworm-slim` pinned by tag **and**
  digest `sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3`
  (recorded in the `org.opencontainers.image.base.digest` label). Both stages
  share the single pinned base via the `NODE_IMAGE` build arg. **Review the
  digest** whenever the Node 22 patch line advances or a base CVE is announced:
  pull `node:22-bookworm-slim`, read its new `RepoDigests`, update the tag +
  digest together, and rebuild `--no-cache`.
- **Non-runtime artifacts:** JavaScript source maps (`*.map`) and TypeScript
  incremental info (`*.tsbuildinfo`) are pruned from `dist` and the production
  `node_modules` in the build stage, so the final image contains neither.
- **Image size:** ~86 MB.
- **User:** non-root `node` (**uid/gid 1000**).
- **Exposed port:** `3000` (override with `PORT`).
- **Entrypoint:** exec-form `["node","dist/main.js"]` — Node receives `SIGTERM`
  directly for graceful shutdown.
- **Migrations are NOT run during the build**, and the **application does not run
  migrations at startup**. Migrations are Supabase SQL files applied out-of-band
  (Phase 18.2/18.3).
- **Image contents:** Node runtime + production dependencies + compiled `dist`
  only. No `.env`, no tests, no source-control metadata, no local Supabase state,
  no dev tools (see `.dockerignore`).
- **Logs:** JSON to **stdout** only; no runtime filesystem writes (a read-only
  container filesystem is compatible). `pino-pretty` is a dev dependency and is
  intentionally absent — the image always logs JSON (`LOG_PRETTY=false`).

## Health & lifecycle

- **Liveness:** `GET /api/v1/health/live` → `200 {status:"ok"}`. Process-only;
  never fails because PostgreSQL or a provider is down. Used by the container
  `HEALTHCHECK` (Node-based, bounded 2.5 s timeout, 20 s start period, 30 s
  interval, 3 retries — no `curl` dependency).
- **Readiness:** `GET /api/v1/health/ready` → `200` when the bounded
  `SELECT 1` DB probe (`DATABASE_READINESS_TIMEOUT_MS`, default 2000) succeeds,
  else `503 DEPENDENCY_FAILURE`. Leaks no URL/SQL/credentials. Orchestrators
  must gate traffic on **readiness**, not liveness.
- **Graceful shutdown:** Nest shutdown hooks are enabled; on `SIGTERM`/`SIGINT`
  the database pool is closed once (idempotent) and a safe log line is emitted. A
  bounded **shutdown watchdog** (`SHUTDOWN_TIMEOUT_MS`, default 15000, range
  1000–120000) force-exits with a non-zero status if graceful shutdown overruns
  the deadline, so the process can never hang. Verified by the smoke test (clean
  `SIGTERM` exit within the grace period) and `shutdown-watchdog.spec.ts` (the
  forced-fallback path, deterministically). **The hosting platform's stop grace
  period must be at least `SHUTDOWN_TIMEOUT_MS`.**
- **Payments disabled in production:** `PAYMENTS_PROVIDER_MODE` defaults to
  `disabled` in production; no provider adapter is registered and every payment
  mutation (initiation, confirmation, refund, webhook) fails safely with `503`
  `PAYMENT_PROVIDER_UNAVAILABLE` before touching any state. `test` mode is
  rejected in production. **Real production payments remain BLOCKED** until a
  documented provider adapter and credentials are supplied in a later phase — an
  honest external/business integration blocker, not a hosting failure.

## Local production-like smoke test

```bash
supabase start                 # disposable local database only
./scripts/smoke-container.sh   # builds the image and runs the full check set
```

Checks: image builds; no accidental files; **no source maps / tsbuildinfo**;
**base image pinned by digest**; **non-root uid**; **fail-fast** on unsafe
production config (secret-free error); liveness `200`; readiness responds safely
(`503` without SSL, `200` when DB reachable); authenticated route `401`;
**payments disabled in production** (webhook `503 PAYMENT_PROVIDER_UNAVAILABLE`);
Swagger `404` in production; graceful `SIGTERM` exit within the bounded deadline;
**no secret in logs**. It never uses a shared/production database and never
publishes the image.

## Environment variables (production)

**Required:** `NODE_ENV=production`, `DATABASE_URL` (non-local, credentials from
the secret manager), `SUPABASE_URL` (or explicit `SUPABASE_JWT_ISSUER` +
`SUPABASE_JWKS_URL`).

**Recommended:** `CORS_ORIGINS` (explicit allowlist — required by validation),
`DATABASE_SSL_MODE=require|verify-full`, `TRUST_PROXY` (explicit positive hop
count behind a load balancer so client IPs are accurate), `SHUTDOWN_TIMEOUT_MS`
(default 15000), pool/timeout tuning.

**Payments:** `PAYMENTS_PROVIDER_MODE` defaults to `disabled` in production and
`test` is rejected, so `PAYMENTS_TEST_WEBHOOK_SECRET` is **not** required in
production (real payments are BLOCKED until a provider adapter is supplied). When
test mode is enabled (non-production only) the secret is **required** — there is
**no random/ephemeral fallback and no runtime default**; a missing, blank,
known-placeholder, or shorter-than-16-character value fails startup, and errors
name only the variable. Automated tests supply an explicit synthetic value via
Jest setup (`test/setup-test-secret.ts`); local developers should generate their
own unique local-only value rather than copy a shared credential.

Startup **fail-fast** validation (`assertProductionConfig`) rejects, before
listening: missing `DATABASE_URL`; non-postgres protocol; localhost DB URL;
`DATABASE_SSL_MODE=disable`; a non-URL/non-https/localhost auth issuer or JWKS;
`HS*`/`none` JWT algorithms; `TRUST_PROXY=true` or a non-hop-count value; empty,
wildcard, or credential/path/query/fragment-bearing `CORS_ORIGINS`; a malformed,
zero, or over-10mb `BODY_LIMIT`; non-boolean or unsafe (`LOG_PRETTY=true`,
`DATABASE_LOG_QUERIES=true`) boolean flags; non-positive rate limits; invalid
pool/timeout values; `PAYMENTS_PROVIDER_MODE=test`; and an out-of-range
`SHUTDOWN_TIMEOUT_MS`. Error messages are actionable and **contain no secret
values** (the database URL is redacted). See `.env.example` for the documented,
placeholder-only template.

## Secret-handling rules

- Secrets are injected by the **platform secret manager** at runtime — never
  baked into the image, committed, or logged.
- `.env` files are git-ignored and excluded from the Docker build context.
- Logs redact auth/cookie headers and never include bodies, SQL, parameters,
  connection strings, or the webhook secret.

## Policies

- **Swagger:** disabled by default in production; enable only via an explicit
  `SWAGGER_ENABLED=true`.
- **CORS:** exact allowlist only, never `*`; production denies when unset
  (validation requires an explicit allowlist).
- **Migrations:** immutable 001–017; **no migration 018**; not executed at build
  or app startup.
- **Rate limiting:** in-memory (per-instance) today; a shared store is required
  only if strict global limits across replicas become necessary (18.2+).

## Platform requirements & open decision

See [`deployment-requirements.md`](./deployment-requirements.md) for the
provider-neutral platform capability list and the deployment-model decision
matrix. **The hosting platform is an open decision deferred to Phase 18.2.**

## Phase boundaries

- **18.2 (not started):** CD workflows, staging/production deploy, registry
  publishing, environment promotion, production migration execution, manual
  production approval gates.
- **18.3 (not started):** cloud provisioning/IaC, DNS/TLS automation, backup
  automation, monitoring-vendor integration, autoscaling.

**Confirmations:** migrations are not executed during image build; application
startup does not run migrations; production credentials must live in the future
platform secret manager; **no real deployment has occurred**.
