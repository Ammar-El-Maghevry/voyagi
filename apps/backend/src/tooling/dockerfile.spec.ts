import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guardrails for the production container definition. These run without a
 * Docker daemon and fail the build if the image loses a security property:
 * non-root user, pinned base/pnpm, no migrations at build time, minimal exposed
 * surface, a liveness health check, and a build context that excludes secrets
 * and local state.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const dockerfile = readFileSync(join(REPO_ROOT, 'Dockerfile'), 'utf8');
const dockerignore = readFileSync(join(REPO_ROOT, '.dockerignore'), 'utf8');

describe('Dockerfile production guardrails', () => {
  it('pins Node 22 and pnpm 11.9.0 and never uses :latest', () => {
    expect(dockerfile).toMatch(/node:22\.\d+\.\d+-bookworm-slim/);
    expect(dockerfile).toContain('pnpm@11.9.0');
    expect(dockerfile).not.toMatch(/:latest/);
  });

  it('pins the base image by an immutable sha256 digest', () => {
    expect(dockerfile).toMatch(
      /ARG NODE_IMAGE=node:22\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64}/,
    );
    // Both stages share the single pinned base via the ARG.
    expect(dockerfile.match(/FROM \$\{NODE_IMAGE\}/g)?.length).toBe(2);
  });

  it('strips source maps and tsbuildinfo before the runtime stage', () => {
    // A prune step removes non-runtime build artifacts in the build stage.
    expect(dockerfile).toMatch(/-name '\*\.map'/);
    expect(dockerfile).toMatch(/-name '\*\.tsbuildinfo'/);
    // The runtime stage must not re-introduce them.
    const runtimeStart = dockerfile.indexOf('AS runtime');
    const runtime = dockerfile.slice(runtimeStart);
    expect(runtime).not.toMatch(/\.map/);
  });

  it('installs with a frozen lockfile', () => {
    expect(dockerfile).toContain('pnpm install --frozen-lockfile');
  });

  it('runs as the non-root node user before the entrypoint', () => {
    const userIndex = dockerfile.indexOf('USER node');
    const cmdIndex = dockerfile.indexOf('CMD [');
    expect(userIndex).toBeGreaterThan(-1);
    expect(cmdIndex).toBeGreaterThan(-1);
    expect(userIndex).toBeLessThan(cmdIndex);
    expect(dockerfile).not.toMatch(/USER\s+root/);
  });

  it('uses an exec-form entrypoint that runs the compiled app', () => {
    expect(dockerfile).toMatch(/CMD \["node", "dist\/main\.js"\]/);
  });

  it('does NOT execute migrations during the image build', () => {
    expect(dockerfile).not.toMatch(
      /db reset|supabase (db|migration)|migrate|psql/i,
    );
  });

  it('exposes only the application port and sets production env', () => {
    expect(dockerfile).toMatch(/EXPOSE 3000/);
    expect(dockerfile).toContain('NODE_ENV=production');
    // No extra published ports.
    expect(dockerfile.match(/EXPOSE /g)?.length).toBe(1);
  });

  it('defines a liveness-based health check that uses node, not curl', () => {
    // Inspect the HEALTHCHECK directive itself (a line starting with the keyword
    // plus its line-continuations), not prose comments that mention the word.
    const lines = dockerfile.split('\n');
    const start = lines.findIndex((l) => l.startsWith('HEALTHCHECK'));
    expect(start).toBeGreaterThan(-1);
    let directive = lines[start];
    for (let i = start; lines[i].trimEnd().endsWith('\\'); i += 1) {
      directive += '\n' + lines[i + 1];
    }
    expect(directive).toContain('/api/v1/health/live');
    expect(directive).toContain('node -e');
    expect(directive).not.toContain('curl');
  });

  it('carries OCI image labels', () => {
    expect(dockerfile).toContain('org.opencontainers.image.title');
  });
});

describe('.dockerignore excludes secrets and local state', () => {
  const required = [
    '**/.env',
    '**/node_modules',
    '**/dist',
    '.git',
    'supabase/.temp',
    'apps/backend/test',
    '**/*.spec.ts',
  ];
  it.each(required)('excludes %s', (pattern) => {
    expect(dockerignore).toContain(pattern);
  });

  it('keeps .env.example available (negated) but ignores real .env files', () => {
    expect(dockerignore).toContain('**/.env');
    expect(dockerignore).toContain('!**/.env.example');
  });
});
