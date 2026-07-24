import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Proves the official secret scan covers the full working set — tracked, staged,
 * unstaged and untracked (non-ignored) files — while excluding ignored and
 * deleted files, and handles awkward filenames. A throwaway git repo is created
 * so each category is exercised deterministically. Secret-shaped fixtures are
 * assembled at runtime so no literal secret appears in this source file.
 */
interface ScanModule {
  collectScanTargets(tracked: string[], others: string[]): string[];
}
const SCRIPT = resolve(process.cwd(), 'scripts/scan-secrets.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require(SCRIPT) as ScanModule;

// AWS's published non-functional EXAMPLE id, split so it is not literal here.
const FAKE_KEY = 'AKIA' + 'IOSFODNN7EXAMPLE';
const secretLine = (label: string): string => `${label} = ${FAKE_KEY}\n`;

describe('collectScanTargets', () => {
  it('deduplicates paths across tracked and untracked listings', () => {
    expect(mod.collectScanTargets(['a.ts', 'b.ts'], ['b.ts', 'c.ts'])).toEqual([
      'a.ts',
      'b.ts',
      'c.ts',
    ]);
  });

  it('preserves spaces and Unicode in filenames', () => {
    const weird = 'weird name-é.txt';
    expect(mod.collectScanTargets([weird], [weird])).toEqual([weird]);
  });
});

describe('security:secrets over a working set (git categories)', () => {
  let repo: string;

  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  };
  const write = (name: string, content: string): void => {
    writeFileSync(join(repo, name), content);
  };

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'voyagi-scan-'));
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');

    // A committed, clean file with no secret.
    write('clean.txt', 'nothing to see here\n');
    // A committed file that will get an unstaged secret edit.
    write('unstaged.txt', 'placeholder\n');
    // A committed file that will be deleted from the working tree.
    write('deleted.txt', 'to be removed\n');
    write('.gitignore', 'ignored.txt\n');
    git('add', '.');
    git('commit', '-q', '-m', 'seed');

    // Unstaged modification introduces a secret into a tracked file.
    write('unstaged.txt', secretLine('UNSTAGED'));
    // Staged new file with a secret.
    write('staged.txt', secretLine('STAGED'));
    git('add', 'staged.txt');
    // Untracked new file with a secret.
    write('untracked.txt', secretLine('UNTRACKED'));
    // Untracked file with an awkward name (spaces + Unicode).
    write('weird name-é.txt', secretLine('WEIRD'));
    // Untracked file with a quote character in the name. With `-z`, git does
    // not quote/escape filenames, so this must round-trip literally.
    write('quote"name.txt', secretLine('QUOTE'));
    // Ignored file with a secret — must NOT be scanned.
    write('ignored.txt', secretLine('IGNORED'));
    // Delete a previously committed file — must NOT be scanned.
    rmSync(join(repo, 'deleted.txt'));
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('flags staged, unstaged, untracked and awkward-name files but not ignored/deleted/clean', () => {
    const result = spawnSync('node', [SCRIPT], {
      cwd: repo,
      encoding: 'utf8',
    });

    // Findings exist → non-zero exit.
    expect(result.status).toBe(1);
    const out = `${result.stdout}\n${result.stderr}`;

    // Covered categories are reported.
    expect(out).toContain('unstaged.txt');
    expect(out).toContain('staged.txt');
    expect(out).toContain('untracked.txt');
    expect(out).toContain('weird name-é.txt');
    expect(out).toContain('quote"name.txt');

    // Excluded categories are not reported.
    expect(out).not.toContain('ignored.txt');
    expect(out).not.toContain('deleted.txt');
    expect(out).not.toContain('clean.txt');

    // The matched secret value is never printed — metadata only.
    expect(out).not.toContain(FAKE_KEY);
    expect(out).toMatch(/aws-access-key-id/);
  });

  it('passes cleanly (exit 0) once the secrets are removed', () => {
    const clean = mkdtempSync(join(tmpdir(), 'voyagi-scan-ok-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: clean, stdio: 'pipe' });
      mkdirSync(join(clean, 'src'));
      writeFileSync(join(clean, 'src', 'ok.ts'), 'export const x = 1;\n');
      const result = spawnSync('node', [SCRIPT], {
        cwd: clean,
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/no findings/);
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }
  });
});

/**
 * Reproduces the exact scenario the independent audit used to demonstrate a
 * fail-OPEN defect: running the scanner where git repository-state discovery
 * cannot succeed. The corrected scanner must fail CLOSED — a non-zero exit,
 * and it must never report a clean/zero-file "no findings" result, since that
 * would silently mean the working set was never actually scanned.
 */
describe('CLI fails closed when Git repository discovery fails', () => {
  it('a non-Git directory: exits non-zero and never claims a clean/zero-file scan', () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), 'voyagi-scan-nogit-'));
    try {
      writeFileSync(join(nonGitDir, 'placeholder.txt'), 'nothing here\n');
      const result = spawnSync('node', [SCRIPT], {
        cwd: nonGitDir,
        encoding: 'utf8',
      });
      const out = `${result.stdout}\n${result.stderr}`;

      expect(result.status).not.toBe(0);
      expect(out).not.toMatch(/no findings/);
      expect(out).not.toMatch(/scanned 0 working-set files/);
      expect(out).toMatch(/unable to discover repository files/);
      expect(out).toMatch(/scan aborted/);
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});
