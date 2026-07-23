import { resolve } from 'node:path';

/**
 * Tests for the secret scanner. Detection inputs are well-known DOCUMENTED
 * placeholder values (e.g. AWS's published EXAMPLE key) or obviously fake
 * material — no real secret appears in this file.
 */
interface ScanModule {
  shouldScan(file: string): boolean;
  scanText(text: string): Array<{ line: number; rule: string }>;
}

const MODULE_PATH = resolve(process.cwd(), 'scripts/scan-secrets.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require(MODULE_PATH) as ScanModule;

const rulesOf = (text: string): string[] =>
  mod.scanText(text).map((f) => f.rule);

describe('secret scanner', () => {
  it('scans source/config extensions and skips lockfiles', () => {
    expect(mod.shouldScan('src/x.ts')).toBe(true);
    expect(mod.shouldScan('a.yml')).toBe(true);
    expect(mod.shouldScan('.env.example')).toBe(true);
    expect(mod.shouldScan('pnpm-lock.yaml')).toBe(false);
    expect(mod.shouldScan('logo.png')).toBe(false);
  });

  // The secret-shaped fixtures below are assembled at runtime from fragments so
  // the literal patterns never appear in this source file — otherwise the
  // scanner would (correctly) flag its own test data. Detection is still proven
  // because `rulesOf` receives the fully-assembled string.
  it('detects a private key block', () => {
    const fake = `-----BEGIN ${'PRIVATE'} KEY-----\nFAKEFAKEFAKE\n-----END PRIVATE KEY-----`;
    expect(rulesOf(fake)).toContain('private-key');
  });

  it('detects a cloud access key id (documented EXAMPLE value)', () => {
    // AWS's own published non-functional example id, split to avoid self-match.
    const akia = 'AKIA' + 'IOSFODNN7EXAMPLE';
    expect(rulesOf(`id = ${akia}`)).toContain('aws-access-key-id');
  });

  it('detects a GitHub-style token shape', () => {
    const shape = 'ghp_' + 'A'.repeat(36);
    expect(rulesOf(`token: ${shape}`)).toContain('github-token');
  });

  it('detects a credentialed remote database URL', () => {
    // Split on `user:` | `pass@host` so the credentialed URL is not literal here.
    const url =
      'DATABASE_URL=postgresql://admin:' +
      's3cr3t@db.prod.example.com:5432/app';
    expect(rulesOf(url)).toContain('credentialed-db-url');
  });

  it('allows local development database URLs (documented test fixture)', () => {
    expect(
      rulesOf('postgresql://postgres:postgres@127.0.0.1:54322/postgres'),
    ).not.toContain('credentialed-db-url');
    expect(
      rulesOf('postgres://postgres:postgres@localhost:5432/postgres'),
    ).not.toContain('credentialed-db-url');
  });

  it('does not flag ordinary configuration or the test webhook secret name', () => {
    expect(
      mod.scanText(
        'const answer = 42;\nCORS_ORIGINS=\nvoyagi-test-webhook-secret',
      ),
    ).toEqual([]);
  });

  it('reports the 1-based line number and never the value', () => {
    const findings = mod.scanText('line1\nAKIAIOSFODNN7EXAMPLE\nline3');
    expect(findings).toEqual([{ line: 2, rule: 'aws-access-key-id' }]);
  });
});
