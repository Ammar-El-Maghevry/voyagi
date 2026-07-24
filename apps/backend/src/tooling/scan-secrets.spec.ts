import { resolve } from 'node:path';

/**
 * Tests for the secret scanner. Detection inputs are well-known DOCUMENTED
 * placeholder values (e.g. AWS's published EXAMPLE key) or obviously fake
 * material — no real secret appears in this file.
 */

/** Shape returned by a (real or fake) `spawnSync('git', ...)` call. */
interface SpawnResult {
  status: number | null;
  signal?: string | null;
  error?: Error;
  stdout: string;
  stderr?: string;
}
type SpawnFn = (...args: unknown[]) => SpawnResult;

interface ScanModule {
  shouldScan(file: string): boolean;
  scanText(text: string): Array<{ line: number; rule: string }>;
  gitListZ(args: string[], spawn?: SpawnFn): string[];
  workingSetFiles(spawn?: SpawnFn): string[];
  GitDiscoveryError: new (args: string[], reason: string) => Error;
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

/**
 * `gitListZ` must fail CLOSED — throw `GitDiscoveryError` — for every failure
 * mode, and only ever return a (possibly empty) list on a genuinely successful
 * (status 0) git invocation. A `spawn` function is injected so every failure
 * mode is exercised deterministically, without depending on a real missing or
 * broken git binary.
 */
describe('gitListZ (fail-closed git discovery)', () => {
  it('parses NUL-delimited output on a successful (status 0) listing', () => {
    const spawn: SpawnFn = () => ({ status: 0, stdout: 'a.ts\0b.ts\0' });
    expect(mod.gitListZ(['ls-files', '-z'], spawn)).toEqual(['a.ts', 'b.ts']);
  });

  it('treats a successful empty listing as a valid empty result (not a failure)', () => {
    const spawn: SpawnFn = () => ({ status: 0, stdout: '' });
    expect(mod.gitListZ(['ls-files', '-z'], spawn)).toEqual([]);
  });

  it('fails closed on a non-zero exit status', () => {
    const spawn: SpawnFn = () => ({ status: 128, stdout: '' });
    expect(() => mod.gitListZ(['ls-files', '-z'], spawn)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('fails closed on a spawnSync error (e.g. git binary not found)', () => {
    const spawn: SpawnFn = () => ({
      status: null,
      error: Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }),
      stdout: '',
    });
    expect(() => mod.gitListZ(['ls-files', '-z'], spawn)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('fails closed when the command is terminated by a signal', () => {
    const spawn: SpawnFn = () => ({
      status: null,
      signal: 'SIGTERM',
      stdout: '',
    });
    expect(() => mod.gitListZ(['ls-files', '-z'], spawn)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('fails closed on a null or undefined exit status with no error/signal', () => {
    const nullStatus: SpawnFn = () => ({ status: null, stdout: '' });
    const undefinedStatus: SpawnFn = () =>
      ({ status: undefined, stdout: '' }) as unknown as SpawnResult;
    expect(() => mod.gitListZ(['ls-files', '-z'], nullStatus)).toThrow(
      mod.GitDiscoveryError,
    );
    expect(() => mod.gitListZ(['ls-files', '-z'], undefinedStatus)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('never leaks raw stdout/stderr content into the thrown error', () => {
    const spawn: SpawnFn = () => ({
      status: 1,
      stdout: '',
      stderr: 'some-possibly-sensitive-stderr-content',
    });
    let message = '';
    try {
      mod.gitListZ(['ls-files', '-z'], spawn);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('some-possibly-sensitive-stderr-content');
    // Safe metadata (the subcommand and a short reason) is still present.
    expect(message).toContain('ls-files');
  });
});

/**
 * `workingSetFiles` must abort the ENTIRE scan — not silently fall back to a
 * partial file list — when either the tracked or the untracked listing fails.
 */
describe('workingSetFiles (both listings must succeed)', () => {
  it('aborts when tracked-file discovery fails (first git call)', () => {
    let call = 0;
    const spawn: SpawnFn = () => {
      call += 1;
      return call === 1
        ? { status: 1, stdout: '' } // tracked listing fails
        : { status: 0, stdout: 'untracked.ts\0' };
    };
    expect(() => mod.workingSetFiles(spawn)).toThrow(mod.GitDiscoveryError);
  });

  it('aborts when untracked-file discovery fails (second git call)', () => {
    let call = 0;
    const spawn: SpawnFn = () => {
      call += 1;
      return call === 1
        ? { status: 0, stdout: 'tracked.ts\0' }
        : { status: 1, stdout: '' }; // untracked listing fails
    };
    expect(() => mod.workingSetFiles(spawn)).toThrow(mod.GitDiscoveryError);
  });

  it('merges both listings when both git calls succeed', () => {
    let call = 0;
    const spawn: SpawnFn = () => {
      call += 1;
      return call === 1
        ? { status: 0, stdout: 'tracked.ts\0' }
        : { status: 0, stdout: 'untracked.ts\0' };
    };
    expect(mod.workingSetFiles(spawn)).toEqual(['tracked.ts', 'untracked.ts']);
  });
});
