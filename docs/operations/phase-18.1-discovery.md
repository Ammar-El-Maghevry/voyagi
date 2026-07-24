# Phase 18.1 — Production Readiness Discovery Report

Branch: `feature/deployment-readiness-infrastructure` · Base: `b04be6f` (main).
Scope: infrastructure & production setup only. No cloud provisioning, no
deployment, no real secrets. Migrations 001–017 are immutable; no migration 018.

## 1. Node and pnpm requirements

- `packageManager`: **pnpm@11.9.0** (root `package.json`). pnpm 11.9.0 requires
  **Node ≥ 22.13**; the CI quality gate pins **Node 22**. `engines.node` is
  `>=22.13.0` in both the root and backend `package.json` (aligned with the
  toolchain floor); the supported/target runtime is **Node 22 LTS**.
- Monorepo (`pnpm-workspace.yaml`): `apps/*`, `packages/*`. The backend has **no
  runtime `@voyagi/*` package imports** (`packages/` holds only `eslint-config`
  and `shared-types`, neither a backend runtime dependency), so the production
  image needs only `@voyagi/backend` and its external dependencies.

## 2. Build command

`pnpm --filter @voyagi/backend run build` → `nest build` (uses
`tsconfig.build.json`, `deleteOutDir: true`).

## 3. Production start command

`node dist/main.js` (`apps/backend` script `start:prod`). Entry: `src/main.ts` →
`dist/main.js`.

## 4. Build output directory

`apps/backend/dist/` (`outDir: ./dist`).

## 5. Application port behavior

`PORT` env (default 3000), validated as int `0–65535`. `app.listen(port)` binds
all interfaces. Global prefix `/api`, URI versioning `/api/v1/...`.

## 6. Required runtime directories / filesystem writes

None. The app writes **no files** at runtime — logs go to **stdout** (pino).
The container filesystem can be read-only except for the standard ephemeral
mounts. No upload/temp directory is used.

## 7. Environment variables

**Required in production (fail-fast expected):**

- `NODE_ENV=production`
- `DATABASE_URL` (pool factory throws if empty in production)
- `SUPABASE_URL` **or** explicit `SUPABASE_JWT_ISSUER` + `SUPABASE_JWKS_URL`
  (JWKS resolver requires a resolvable URL in production)

**Optional (typed, safe defaults):** `PORT`, `APP_NAME`, `BODY_LIMIT`,
`TRUST_PROXY`, `LOG_LEVEL`, `LOG_PRETTY`, `LOG_SLOW_REQUEST_MS`, `CORS_ORIGINS`,
`CORS_CREDENTIALS`, `RATE_LIMIT_TTL`, `RATE_LIMIT_LIMIT`, per-category
`RATE_LIMIT_*`, `SWAGGER_ENABLED`, `SWAGGER_PATH`, `DATABASE_APP_NAME`,
`DATABASE_POOL_MIN/MAX`, `DATABASE_CONNECTION_TIMEOUT_MS`,
`DATABASE_IDLE_TIMEOUT_MS`, `DATABASE_STATEMENT_TIMEOUT_MS`,
`DATABASE_READINESS_TIMEOUT_MS`, `DATABASE_SSL_MODE`, `DATABASE_SLOW_QUERY_MS`,
`SUPABASE_JWT_AUDIENCE`, `SUPABASE_JWT_ALGORITHMS`, `AUTH_CLOCK_TOLERANCE_SECONDS`,
`AUTH_JWKS_CACHE_TTL_MS`, `AUTH_JWKS_TIMEOUT_MS`, `AUTH_JWKS_COOLDOWN_MS`.

**Secret (never commit / never log):** `DATABASE_URL` (contains credentials),
`PAYMENTS_TEST_WEBHOOK_SECRET` (test provider shared secret; see §21).

**Environment-specific defaults:** `DATABASE_SSL_MODE` (disable non-prod /
require prod), `LOG_LEVEL` (debug/info), `LOG_PRETTY` (true/false),
`SWAGGER_ENABLED` (true/false), `DATABASE_URL`/`SUPABASE_URL` (local defaults
non-prod / must be explicit prod).

**Unsafe in production (must be rejected/avoided):** `DATABASE_LOG_QUERIES=true`,
`LOG_PRETTY=true`, `SWAGGER_ENABLED=true` (unless deliberately gated),
localhost/`127.0.0.1` `DATABASE_URL`, `PAYMENTS_TEST_WEBHOOK_SECRET` left at its
placeholder default, empty `CORS_ORIGINS`, `HS*`/`none` in
`SUPABASE_JWT_ALGORITHMS`.

## 8. External dependencies

- **PostgreSQL/Supabase** — sole hard dependency (`pg` pool). Required at
  readiness; the app boots even if the DB is temporarily unreachable (lazy pool).
- **JWKS/Auth** — Supabase JWKS endpoint over outbound HTTPS; asymmetric
  verification only (`RS256`/`ES256`); no shared secret. Cached with bounded
  fetch timeout and rotation handling.
- **Payment providers** — controlled by `PAYMENTS_PROVIDER_MODE`
  (`disabled` | `test`). Production defaults to **disabled**: NO provider adapter
  is registered and every payment mutation fails safely with `503`
  `PAYMENT_PROVIDER_UNAVAILABLE`. Non-production defaults to `test` (the
  deterministic in-repo `TestPaymentProvider`). No real provider network
  dependency exists yet — production payments remain an external/business
  integration blocker until a documented provider adapter and credentials are
  supplied in a later phase.
- **Logging/monitoring** — stdout structured logs (pino); no vendor SDK.

## 9. Liveness / readiness behavior

- **Liveness** `GET /api/v1/health/live` → `{ status: 'ok' }`, process-only,
  independent of PostgreSQL. Public, throttle-skipped.
- **Readiness** `GET /api/v1/health/ready` aggregates `ReadinessIndicator`s. The
  `DatabaseReadinessIndicator` runs a bounded `SELECT 1`
  (`DATABASE_READINESS_TIMEOUT_MS`, default 2000). On DB down → `503`
  `DEPENDENCY_FAILURE`, leaking no URL/SQL/credentials.

## 10. Graceful-shutdown behavior

`app.enableShutdownHooks()` (configure-app) registers Nest signal handlers
(SIGTERM/SIGINT/…). `DatabaseService.onApplicationShutdown()` calls `pool.end()`
once (idempotent) and logs a safe message. No other long-lived resources. A
bounded **shutdown watchdog** (`SHUTDOWN_TIMEOUT_MS`, default 15000, range
1000–120000) arms a single unref'd deadline timer on the first SIGTERM/SIGINT and
force-exits with a non-zero status if graceful shutdown overruns the deadline, so
the process can never hang. It logs only lifecycle metadata (signal, deadline).

## 11. Database connection / timeout behavior

Single shared `pg` Pool (`postgres-pool.factory`): fail-fast on missing URL in
production; `min/max`, `connectionTimeoutMillis`, `idleTimeoutMillis`,
`statement_timeout`, SSL by mode, `allowExitOnIdle: false`; idle-client errors
handled (never crash), connection string never logged.

## 12. Migration execution model

Migrations are **SQL files under `supabase/migrations/`** applied by the
Supabase CLI (`supabase db reset` locally; CI applies to a disposable DB). The
**application does not run migrations at startup**, and the **Docker build must
not run migrations**. Production migration execution is a Phase 18.2/18.3
concern.

## 13. Production logging behavior

pino via `nestjs-pino`. Production defaults: `level=info`, `pretty=false`
(JSON to stdout). Redaction: auth/cookie headers removed; request serializer is
an allowlist (`id`, `correlationId`, `method`, path-only `url` — query string
stripped); no request/response body, SQL text, or parameters logged.

## 14. Swagger production behavior

`swaggerConfig.enabled` defaults to **false in production**
(`SWAGGER_ENABLED` must be explicitly `true` to expose). Served at `api/docs`
when enabled.

## 15. CORS production behavior

`buildCorsOptions`: production with empty `CORS_ORIGINS` → `origin: false`
(deny all); non-empty → exact allowlist, **never `*`**, never `true` in prod.
Methods/headers allowlisted (incl. `Authorization`, `Idempotency-Key`).

## 16. Trusted-proxy behavior

`TRUST_PROXY` unset → Express `trust proxy` **off** (default). The
`IdentityThrottlerGuard` keys anonymous callers on `req.ip`; with trust-proxy
off, spoofed `X-Forwarded-For` cannot shift buckets (spoof-resistant). Behind a
real load balancer, operators must set `TRUST_PROXY` to the correct hop count to
recover the true client IP — a deployment-time decision (see gaps §20).
Production validation accepts only an **explicit positive hop count** (or unset);
`TRUST_PROXY=true` and arbitrary strings are rejected so an over-broad trust
setting cannot let a spoofed `X-Forwarded-For` bypass anonymous rate-limit
buckets.

## 17. Body-size limits

`BODY_LIMIT` (default `100kb`) applied to JSON and urlencoded parsers; oversize →
`413 PAYLOAD_TOO_LARGE`. Raw body preserved for webhook signature verification.

## 18. Rate-limit storage limitation

`ThrottlerModule` uses the **default in-memory storage** (per-process). Buckets
are **not shared across replicas**, so horizontal scaling multiplies effective
limits by the instance count. Acceptable for single-instance; a shared store
(e.g. Redis) is a future (18.2+) enhancement. Documented, not fixed here.

## 19. Containerization gaps (addressed in this phase)

- No Dockerfile / `.dockerignore` (only an empty root `docker-compose.yml`).
- No non-root runtime, image labels, or health check.
- No local production-like smoke procedure.

## 20. Production configuration gaps (addressed in this phase)

- No central **production** validation: presence-only checks are deep in the app
  (pool/JWKS). Missing fail-fast for: localhost `DATABASE_URL` in prod, empty
  `CORS_ORIGINS` in prod, `HS*`/`none` algorithms, placeholder webhook secret,
  numeric `BODY_LIMIT` sanity, and cross-field production rules.
- Trusted-proxy guidance for load-balanced deployments (documentation).

## 21. Security findings by severity

- **CRITICAL:** none.
- **HIGH:** none.
- **MEDIUM (all mitigated in this phase):**
  - The deterministic `TestPaymentProvider` was registered unconditionally, so a
    production deployment could have exercised a fake payment integration. →
    Mitigated by `PAYMENTS_PROVIDER_MODE` (production default `disabled`; `test`
    rejected in production); the test adapter is never registered in production
    and all payment mutations fail safely. Real production payments remain
    **BLOCKED** pending a documented provider adapter — an honest external
    integration blocker, not an infrastructure failure.
  - `PAYMENTS_TEST_WEBHOOK_SECRET` fell back to the hardcoded placeholder
    `'voyagi-test-webhook-secret'`. → The placeholder is no longer used as a
    shared secret and there is **no random/ephemeral fallback and no runtime
    default**. When test mode is enabled the secret is **required** and must be a
    non-placeholder value of at least 16 characters (missing, blank, placeholder
    or too-short fails startup). Disabled mode requires no payment secret. Errors
    name only the variable and never the value.
  - Production could previously start with an accidental **localhost
    `DATABASE_URL`**, **empty CORS allowlist**, over-broad `TRUST_PROXY`,
    `LOG_PRETTY=true`, `DATABASE_LOG_QUERIES=true`, an oversized `BODY_LIMIT`, or
    a non-URL auth issuer. → Mitigated by the strengthened fail-fast production
    validator.
- **LOW:**
  - In-memory rate-limit storage is per-instance (§18) — scaling limitation.
  - `TRUST_PROXY` must be set correctly behind an LB for accurate client IPs
    (§16).
- **INFORMATIONAL:**
  - Logs are stdout-only; no runtime filesystem writes (read-only-fs friendly).
  - `engines.node` is `>=22.13.0` (root + backend), matching the pnpm 11.9.0 /
    Node 22.13+ toolchain floor. (Corrected in this phase from the earlier
    `>=20`.)

## 22. Is a database migration required?

**No.** Every production-readiness gap above is addressed at the
application/config/containerization layer. Migrations 001–017 remain immutable
and **no migration 018 is created**.
