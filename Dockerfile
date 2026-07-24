# syntax=docker/dockerfile:1
#
# Voyagi backend — production image (multi-stage, provider-neutral).
#
# - Node 22 (pinned patch) + pnpm 11.9.0, frozen lockfile.
# - Build stage compiles the backend; a pnpm `deploy` produces a flattened,
#   production-only node_modules with no dev tooling.
# - Runtime stage contains only Node, production dependencies and `dist`,
#   runs as the non-root `node` user, exposes only the app port, uses an
#   exec-form entrypoint (so Node receives SIGTERM directly for graceful
#   shutdown) and ships a liveness-based HEALTHCHECK.
# - No migrations are executed during the build. No secrets or .env are copied
#   (see .dockerignore). Never tag/publish this as `latest`.
#
# Base image is pinned by exact tag AND digest so build and runtime are fully
# reproducible. Review the digest whenever the Node 22 patch line advances or a
# base-image CVE is announced: pull `node:22-bookworm-slim`, read the new
# `RepoDigests`, update NODE_IMAGE (tag + digest) together, and rebuild.

ARG NODE_IMAGE=node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

########################  Build stage  ########################
FROM ${NODE_IMAGE} AS build

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

WORKDIR /repo

# Manifests first so dependency installation is cached independently of source.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json apps/backend/package.json

# Install the full workspace dependencies from the frozen lockfile.
RUN pnpm install --frozen-lockfile

# Backend build inputs, then compile to apps/backend/dist.
COPY apps/backend/tsconfig.json apps/backend/tsconfig.build.json apps/backend/nest-cli.json apps/backend/
COPY apps/backend/src apps/backend/src
RUN pnpm --filter @voyagi/backend run build

# Flatten a production-only, self-contained deployment (prod deps, no dev tools).
RUN pnpm --filter=@voyagi/backend --prod deploy --legacy /prod

# Strip non-runtime build artifacts before they can reach the runtime stage:
# JavaScript source maps and TypeScript incremental build info are debug-only
# and never needed to run the compiled app. Applied to both the compiled output
# and the flattened production dependencies.
RUN find /repo/apps/backend/dist /prod -type f \
      \( -name '*.map' -o -name '*.tsbuildinfo' \) -delete

########################  Runtime stage  ########################
FROM ${NODE_IMAGE} AS runtime

LABEL org.opencontainers.image.title="voyagi-backend" \
      org.opencontainers.image.description="Voyagi multi-tenant bus transport backend API (NestJS)" \
      org.opencontainers.image.source="https://github.com/Ammar-El-Maghevry/voyagi" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.base.name="docker.io/library/node:22.23.1-bookworm-slim" \
      org.opencontainers.image.base.digest="sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3"

# Production runtime defaults. Secrets (DATABASE_URL, provider secrets) are
# injected by the platform at runtime — never baked into the image.
ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Copy only what the runtime needs: production node_modules, the manifest and the
# compiled output. Owned by the unprivileged `node` user shipped in the base image.
COPY --from=build --chown=node:node /prod/node_modules ./node_modules
COPY --from=build --chown=node:node /prod/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/backend/dist ./dist

# Drop privileges: run as the non-root `node` user (uid/gid 1000).
USER node

EXPOSE 3000

# Liveness-based health check (process only; does NOT fail on transient DB loss).
# Uses Node (no curl in the slim image) with a bounded timeout. Orchestrators
# should use /api/v1/health/ready separately for traffic readiness.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.PORT||3000;require('http').get({host:'127.0.0.1',port:p,path:'/api/v1/health/live',timeout:2500},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Exec form so Node is PID-adjacent and receives SIGTERM/SIGINT directly, which
# Nest's shutdown hooks use to close the database pool gracefully.
CMD ["node", "dist/main.js"]
