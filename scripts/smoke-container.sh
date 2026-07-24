#!/usr/bin/env bash
#
# Local production-like smoke test for the Voyagi backend container (Phase 18.1).
#
# Deterministic, self-contained and safe: it builds the production image, runs
# it against a DISPOSABLE LOCAL PostgreSQL only, and verifies liveness,
# readiness, route protection, Swagger exposure, non-root execution, graceful
# SIGTERM shutdown and log hygiene. It NEVER uses a shared/production database,
# never publishes the image, and uses placeholder-only configuration.
#
# Requirements: Docker, a local Supabase/Postgres reachable on the host
# (127.0.0.1:54322), and curl. Run `supabase start` first.
#
# Usage:  ./scripts/smoke-container.sh
set -euo pipefail

IMAGE="voyagi-backend:18.1-smoke"
NAME_PROD="voyagi-smoke-prod-$$"
NAME_DEV="voyagi-smoke-dev-$$"
PORT_PROD=13801
PORT_DEV=13802
# Placeholder-only, local-safe values. NOT real secrets.
WEBHOOK_SECRET="local-smoke-webhook-secret-not-real"
DB_USER="postgres"
DB_PASS="postgres"
DB_HOST="host.docker.internal"
DB_PORT="54322"

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILED=1; }
info() { printf '\n== %s ==\n' "$1"; }
FAILED=0

cleanup() {
  docker rm -f "$NAME_PROD" "$NAME_DEV" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# curl helper: prints the HTTP status code for a GET.
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$1" 2>/dev/null || echo "000"; }
body() { curl -s --max-time 5 "$1" 2>/dev/null || echo ""; }

info "1. Build the production image"
docker build -t "$IMAGE" -f Dockerfile . >/dev/null
pass "image built ($IMAGE)"

info "2. Inspect image for accidental files"
LEAKS=$(docker run --rm --entrypoint sh "$IMAGE" -c \
  "find /app -maxdepth 4 \( -name '.env' -o -name '.env.*' -o -name '*.spec.ts' -o -name '*-spec.ts' -o -path '*/.git/*' \) ! -path '*/node_modules/*' 2>/dev/null | head" )
if [ -z "$LEAKS" ]; then pass "no .env / test / .git files in image"; else fail "unexpected files: $LEAKS"; fi

info "2b. Inspect image for non-runtime build artifacts (maps / tsbuildinfo)"
ARTIFACTS=$(docker run --rm --entrypoint sh "$IMAGE" -c \
  "find /app \( -name '*.map' -o -name '*.tsbuildinfo' \) 2>/dev/null | head")
if [ -z "$ARTIFACTS" ]; then pass "no source maps or tsbuildinfo in image"; else fail "build artifacts present: $ARTIFACTS"; fi

info "2c. Confirm the base image is pinned by digest"
BASE_DIGEST=$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.base.digest" }}' "$IMAGE" 2>/dev/null || echo "")
case "$BASE_DIGEST" in
  sha256:*) pass "base image pinned by digest ($BASE_DIGEST)" ;;
  *) fail "base image digest label missing" ;;
esac

info "3. Confirm the container runs as non-root"
UID_GID=$(docker run --rm "$IMAGE" node -e "process.stdout.write(process.getuid()+':'+process.getgid())")
if [ "$UID_GID" != "0:0" ]; then pass "runs as non-root ($UID_GID)"; else fail "container runs as root"; fi

info "3b. Production config fail-fast (container refuses unsafe config)"
# A production start with a localhost DB + empty CORS must be rejected before
# listening, with an actionable but secret-free error.
BAD_LOGS=$(docker run --rm --name "${NAME_PROD}-bad" \
  -e NODE_ENV=production \
  -e "DATABASE_URL=postgresql://postgres:${DB_PASS}@127.0.0.1:54322/postgres" \
  -e SUPABASE_URL=https://project.supabase.co \
  -e CORS_ORIGINS= \
  -e PAYMENTS_TEST_WEBHOOK_SECRET=voyagi-test-webhook-secret \
  "$IMAGE" 2>&1 || true)
if echo "$BAD_LOGS" | grep -q "Refusing to start"; then
  pass "unsafe production config is rejected at startup"
else
  fail "unsafe production config was not rejected"
fi
if echo "$BAD_LOGS" | grep -qE "${DB_PASS}@127|voyagi-test-webhook-secret"; then
  fail "fail-fast error leaked a secret value"
else
  pass "fail-fast error contains no secret values"
fi

info "3c. Test mode without an explicit secret fails safely"
# Enabling the test provider (non-production) without PAYMENTS_TEST_WEBHOOK_SECRET
# must fail startup with a secret-free, variable-named error — no random fallback.
TESTSECRET_LOGS=$(docker run --rm --name "${NAME_PROD}-nosecret" \
  -e NODE_ENV=development \
  -e PAYMENTS_PROVIDER_MODE=test \
  -e DATABASE_SSL_MODE=disable \
  "$IMAGE" 2>&1 || true)
if echo "$TESTSECRET_LOGS" | grep -q "PAYMENTS_TEST_WEBHOOK_SECRET is required"; then
  pass "test mode without a secret fails startup (no ephemeral fallback)"
else
  fail "test mode without a secret did not fail as expected"
fi

info "4-9. Production-posture run (validation on, Swagger off, DB via host)"
# Full production-VALID placeholder config. SSL is required in production; the
# local PG does not offer SSL, so readiness is expected to fail SAFELY (503) —
# this doubles as the "readiness fails safely when DB unavailable" check.
# NOTE: NO PAYMENTS_TEST_WEBHOOK_SECRET is provided — production defaults the
# provider mode to `disabled`, which requires no payment secret to start.
docker run -d --name "$NAME_PROD" -p "${PORT_PROD}:3000" \
  --add-host=host.docker.internal:host-gateway \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e "DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/postgres" \
  -e DATABASE_SSL_MODE=no-verify \
  -e SUPABASE_URL=https://project.supabase.co \
  -e CORS_ORIGINS=https://app.voyagi.mr \
  -e SHUTDOWN_TIMEOUT_MS=15000 \
  "$IMAGE" >/dev/null
# Wait for liveness (bounded).
for _ in $(seq 1 20); do [ "$(code http://127.0.0.1:${PORT_PROD}/api/v1/health/live)" = "200" ] && break; sleep 0.5; done

[ "$(code http://127.0.0.1:${PORT_PROD}/api/v1/health/live)" = "200" ] \
  && pass "liveness returns 200 (process alive)" || fail "liveness not 200"

READY_CODE=$(code http://127.0.0.1:${PORT_PROD}/api/v1/health/ready)
if [ "$READY_CODE" = "200" ] || [ "$READY_CODE" = "503" ]; then
  pass "readiness responds safely ($READY_CODE)"
else
  fail "readiness returned $READY_CODE"
fi
READY_BODY=$(body http://127.0.0.1:${PORT_PROD}/api/v1/health/ready)
if echo "$READY_BODY" | grep -qiE 'postgres|password|@host|select |54322'; then
  fail "readiness body leaked internals"
else
  pass "readiness body leaks no DB/URL/SQL details"
fi

[ "$(code http://127.0.0.1:${PORT_PROD}/api/v1/auth/me)" = "401" ] \
  && pass "authenticated route protected (401)" || fail "auth route not protected"

# Payments default to DISABLED in production: the public webhook must fail safely
# with 503 PAYMENT_PROVIDER_UNAVAILABLE (no provider adapter is registered).
PAY_BODY=$(curl -s --max-time 5 -X POST \
  -H 'content-type: application/json' -H 'x-voyagi-signature: anything' \
  -d '{"eventId":"e1"}' \
  "http://127.0.0.1:${PORT_PROD}/api/v1/webhooks/payments/test" 2>/dev/null || echo "")
PAY_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST \
  -H 'content-type: application/json' -H 'x-voyagi-signature: anything' \
  -d '{"eventId":"e1"}' \
  "http://127.0.0.1:${PORT_PROD}/api/v1/webhooks/payments/test" 2>/dev/null || echo "000")
if [ "$PAY_CODE" = "503" ] && echo "$PAY_BODY" | grep -q "PAYMENT_PROVIDER_UNAVAILABLE"; then
  pass "payments disabled in production (webhook 503 provider-unavailable)"
else
  fail "payments not disabled in production (code $PAY_CODE)"
fi

SWAGGER_CODE=$(code http://127.0.0.1:${PORT_PROD}/api/docs)
[ "$SWAGGER_CODE" = "404" ] \
  && pass "Swagger not exposed in production (404)" || fail "Swagger exposed ($SWAGGER_CODE)"

info "10-11. Graceful SIGTERM shutdown (within the bounded deadline)"
# `docker stop` sends SIGTERM then SIGKILL after the grace period; a clean exit
# within the grace window proves graceful shutdown. SHUTDOWN_TIMEOUT_MS (set to
# 15000 above) bounds the wait so the process can never hang; the forced-fallback
# path itself is proven deterministically in shutdown-watchdog.spec.ts.
START=$(date +%s)
docker stop -t 10 "$NAME_PROD" >/dev/null
END=$(date +%s)
EXIT_CODE=$(docker inspect -f '{{.State.ExitCode}}' "$NAME_PROD")
if [ "$((END-START))" -lt 10 ] && { [ "$EXIT_CODE" = "0" ] || [ "$EXIT_CODE" = "143" ]; }; then
  pass "container exited gracefully in $((END-START))s (exit $EXIT_CODE)"
else
  fail "graceful shutdown not observed (exit $EXIT_CODE, $((END-START))s)"
fi

info "12. Log hygiene — no secret appears in container logs"
LOGS=$(docker logs "$NAME_PROD" 2>&1)
if echo "$LOGS" | grep -qF "$WEBHOOK_SECRET" || echo "$LOGS" | grep -qE "${DB_USER}:${DB_PASS}@"; then
  fail "a secret/credential appeared in logs"
else
  pass "no webhook secret or DB credential in logs"
fi

info "Bonus: DB-connected readiness (dev mode, Swagger explicitly off, SSL disabled)"
# Proves the in-container DB probe reaches the disposable local database.
# LOG_PRETTY=false because pino-pretty is a DEV dependency and is intentionally
# absent from the production image — the image always logs JSON.
# PAYMENTS_PROVIDER_MODE=disabled: payments are irrelevant to this DB-probe check,
# and disabled mode needs no test secret (test mode would require an explicit one).
docker run -d --name "$NAME_DEV" -p "${PORT_DEV}:3000" \
  --add-host=host.docker.internal:host-gateway \
  -e NODE_ENV=development \
  -e SWAGGER_ENABLED=false \
  -e LOG_PRETTY=false \
  -e PAYMENTS_PROVIDER_MODE=disabled \
  -e "DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/postgres" \
  -e DATABASE_SSL_MODE=disable \
  "$IMAGE" >/dev/null
for _ in $(seq 1 20); do [ "$(code http://127.0.0.1:${PORT_DEV}/api/v1/health/live)" = "200" ] && break; sleep 0.5; done
DEV_READY=$(code http://127.0.0.1:${PORT_DEV}/api/v1/health/ready)
[ "$DEV_READY" = "200" ] \
  && pass "readiness UP against local database (200)" || fail "DB-connected readiness returned $DEV_READY"
[ "$(code http://127.0.0.1:${PORT_DEV}/api/docs)" = "404" ] \
  && pass "Swagger disabled when SWAGGER_ENABLED=false (404)" || fail "Swagger exposed in dev override"
docker stop -t 10 "$NAME_DEV" >/dev/null

info "Result"
if [ "$FAILED" = "0" ]; then
  printf '\033[32mAll container smoke checks passed.\033[0m\n'
else
  printf '\033[31mOne or more container smoke checks FAILED.\033[0m\n'; exit 1
fi
