# Voyagi Backend — Deployment Requirements (Provider-Neutral)

Phase 18.1 deliverable. This document states the **capabilities the future
hosting platform must provide** and compares deployment models **without
selecting one**. No provider-specific Terraform, cloud configuration, or
credentials are included. Platform selection is an explicit **open decision**
deferred to Phase 18.2.

## 1. Required platform capabilities

| Capability                      | Requirement for Voyagi                                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker/OCI image execution      | Run a standard linux/amd64 OCI image; exec-form entrypoint; honor `SIGTERM`.                                                                         |
| Node 22 runtime                 | The image bundles Node 22; the platform must run arbitrary OCI images (no managed-Node version lock-in required).                                    |
| Outbound HTTPS                  | Egress to the Supabase **JWKS** endpoint and (future) payment providers.                                                                             |
| Secure environment variables    | Inject secrets (`DATABASE_URL`, provider secrets) from a **platform secret manager** — never baked into the image or repo.                           |
| Private PostgreSQL connectivity | Reach Supabase/Postgres, ideally over a private network; TLS (`DATABASE_SSL_MODE=require`/`verify-full`).                                            |
| Health-check support            | Poll `GET /api/v1/health/live` for liveness (process only).                                                                                          |
| Readiness gating                | Poll `GET /api/v1/health/ready` for traffic gating (bounded DB probe, `503` when not ready). Kept separate from liveness.                            |
| Restart policy                  | Automatic restart on process exit / failed liveness, with a startup grace period.                                                                    |
| Rolling / zero-downtime deploys | Start new instance, wait for readiness, drain and `SIGTERM` the old one (graceful shutdown closes the pool).                                         |
| Shutdown grace period           | Allow at least `SHUTDOWN_TIMEOUT_MS` (default 15 s) between `SIGTERM` and `SIGKILL`; the app bounds its own shutdown and force-exits if it overruns. |
| Manual production approval      | A human gate before production releases (enforced in Phase 18.2 CD, not here).                                                                       |
| Log collection                  | Capture **stdout** JSON logs (pino); no file/log-agent inside the container.                                                                         |
| Metrics integration             | Scrape/forward runtime metrics (platform-level; no vendor SDK embedded).                                                                             |
| Custom domain + TLS             | Terminate TLS at the edge and route a custom domain to the container port.                                                                           |
| Resource limits                 | Configurable CPU/memory limits and requests.                                                                                                         |
| Regional placement              | Deploy close to the database region to minimize latency.                                                                                             |
| Backups                         | Database backups are the **database platform's** responsibility (Supabase); the stateless app needs none.                                            |
| Rollback support                | Redeploy a previous immutable image tag (never `latest`).                                                                                            |

## 2. Runtime profile (informs sizing)

- **Stateless**, single process, no local disk writes (logs to stdout).
- Read-only container filesystem is compatible.
- One outbound dependency at readiness (PostgreSQL) + JWKS over HTTPS.
- In-memory rate-limit store ⇒ rate limits are **per-instance** today; a shared
  store (e.g. Redis) is required _only if_ strict global limits across many
  replicas become necessary (future).
- Behind a load balancer set `TRUST_PROXY` to the correct hop count so client IP
  is accurate for the anonymous rate-limit bucket.

## 3. Deployment-model decision matrix (no selection)

Models compared: **(1) Managed container platform** (e.g. a PaaS that runs OCI
images with built-in health checks, secrets, TLS, rolling deploys); **(2) Docker
on a managed VPS** (single VM running the image via a process/compose
supervisor); **(3) Kubernetes / container orchestration**.

| Criterion                            | 1 · Managed container platform                    | 2 · Docker on managed VPS                    | 3 · Kubernetes / orchestration             |
| ------------------------------------ | ------------------------------------------------- | -------------------------------------------- | ------------------------------------------ |
| Operational complexity               | **Low** — platform handles health, TLS, rollout   | Medium — you own the VM, updates, supervisor | **High** — cluster, manifests, controllers |
| Cost predictability                  | Medium–High (per-instance/usage pricing)          | **High** (flat VM cost)                      | Low–Medium (cluster overhead)              |
| Scalability                          | **High** (managed autoscale)                      | Low (vertical / manual)                      | **High** (HPA, multi-node)                 |
| Security responsibility              | Mostly platform (shared)                          | Mostly **you** (OS patching, hardening)      | Split; large surface to secure             |
| Backup responsibility                | DB platform (Supabase); app stateless             | DB platform; app stateless                   | DB platform; app stateless                 |
| Rollback capability                  | **Built-in** (previous image/release)             | Manual (redeploy previous tag)               | Built-in (rollout undo)                    |
| Maintenance burden                   | **Low**                                           | Medium–High                                  | High                                       |
| Suitability for current Voyagi stage | **Strong** — single stateless service, small team | Reasonable — cheapest, more ops              | Overkill now — scale not yet required      |

**Reading of the matrix (non-binding):** for a single stateless service at
Voyagi's current stage, model **1** minimizes operational burden and gives
built-in rollback/health/TLS; model **2** is cheapest but shifts OS/security
maintenance to the team; model **3** is premature until multi-service scale and
a dedicated platform capability exist. **No model is selected here** — this is
recorded as an open decision for Phase 18.2.

## 4. Explicitly out of scope (Phase 18.2 / 18.3)

Deployment workflows, staging/production deploys, registry publishing, DNS
changes, cloud provisioning, backup automation, production migration execution,
and monitoring-vendor integration. This document adds **no** provider-specific
IaC or credentials.
