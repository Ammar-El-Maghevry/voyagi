import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * The format-check gate is a CommonJS script under `scripts/`. Load it via a
 * computed `require` path (non-literal, so TypeScript performs no module
 * resolution on the untyped `.cjs`). `process.cwd()` is `apps/backend` under
 * `pnpm test`.
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

type RefExistsFn = (fullRef: string) => boolean;

interface FormatCheckModule {
  isSupported(file: string): boolean;
  parseNameStatusZ(output: string): string[];
  parseZList(output: string): string[];
  resolveBase(
    gitZ: (args: string[]) => string,
    refExistsFn: RefExistsFn,
  ): string;
  resolveRepoRoot(spawn?: SpawnFn): string;
  refExists(fullRef: string, options?: unknown, spawn?: SpawnFn): boolean;
  BASE_CANDIDATES: ReadonlyArray<{ ref: string; fullRef: string }>;
  gatherChangedFiles(
    gitZ: (args: string[]) => string,
    repoRoot: string,
    fileExists?: (f: string) => boolean,
    refExistsFn?: RefExistsFn,
  ): string[];
  makeGitZ(repoRoot: string, spawn?: SpawnFn): (args: string[]) => string;
  checkWithPrettier(files: string[], repoRoot: string): number;
  gitRun(args: string[], options?: unknown, spawn?: SpawnFn): string;
  GitDiscoveryError: new (args: string[], reason: string) => Error;
}

const MODULE_PATH = resolve(process.cwd(), 'scripts/format-check.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require(MODULE_PATH) as FormatCheckModule;

function nameStatus(records: string[][]): string {
  return records.length ? records.flat().join('\0') + '\0' : '';
}

function zList(paths: string[]): string {
  return paths.length ? paths.join('\0') + '\0' : '';
}

/**
 * Build an injectable git runner returning canned NUL-delimited output per
 * source. Also records the argv of every call so exclusion flags can be asserted.
 */
function fakeGit(sources: {
  base?: string;
  committed?: string[][];
  staged?: string[][];
  unstaged?: string[][];
  untracked?: string[];
}): { git: (args: string[]) => string; calls: string[][] } {
  const calls: string[][] = [];
  const git = (args: string[]): string => {
    calls.push(args);
    if (args[0] === 'merge-base') return sources.base ?? 'BASE_SHA';
    if (args[0] === 'ls-files') return zList(sources.untracked ?? []);
    if (args[0] === 'diff' && args.includes('--cached')) {
      return nameStatus(sources.staged ?? []);
    }
    if (args[0] === 'diff' && args.includes('BASE_SHA')) {
      return nameStatus(sources.committed ?? []);
    }
    if (args[0] === 'diff') return nameStatus(sources.unstaged ?? []);
    return '';
  };
  return { git, calls };
}

describe('format-check helper', () => {
  const always = (): boolean => true;
  // REPO_ROOT is a fake path (no real git checkout there), so every
  // gatherChangedFiles call below supplies an explicit refExistsFn instead of
  // relying on the default (which would spawn a real `git show-ref`).
  const alwaysRef: RefExistsFn = () => true;
  const REPO_ROOT = '/repo';

  it('supports the documented Prettier extensions only', () => {
    for (const ok of [
      'a.ts',
      'a.js',
      'a.mjs',
      'a.cjs',
      'a.json',
      'a.md',
      'a.yml',
      'a.yaml',
    ]) {
      expect(mod.isSupported(ok)).toBe(true);
    }
    for (const no of [
      'a.sql',
      'a.png',
      'a.lock',
      'Dockerfile',
      'a.txt',
      'a.snap',
    ]) {
      expect(mod.isSupported(no)).toBe(false);
    }
  });

  it('parses added/modified records and a plain z-list', () => {
    expect(
      mod.parseNameStatusZ(
        nameStatus([
          ['A', 'a.ts'],
          ['M', 'b.md'],
        ]),
      ),
    ).toEqual(['a.ts', 'b.md']);
    expect(mod.parseZList(zList(['x.ts', 'y.json']))).toEqual([
      'x.ts',
      'y.json',
    ]);
    expect(mod.parseNameStatusZ('')).toEqual([]);
  });

  it('uses the destination path for renamed files', () => {
    expect(
      mod.parseNameStatusZ(nameStatus([['R100', 'old.ts', 'new.ts']])),
    ).toEqual(['new.ts']);
  });

  it('excludes deleted files', () => {
    expect(
      mod.parseNameStatusZ(
        nameStatus([
          ['D', 'gone.ts'],
          ['A', 'kept.ts'],
        ]),
      ),
    ).toEqual(['kept.ts']);
  });

  it('handles filenames with spaces and Unicode', () => {
    const out = nameStatus([
      ['A', 'a file with spaces.ts'],
      ['A', 'café/naïve—file.ts'],
    ]);
    expect(mod.parseNameStatusZ(out)).toEqual([
      'a file with spaces.ts',
      'café/naïve—file.ts',
    ]);
  });

  it('gathers a committed branch change', () => {
    const { git } = fakeGit({ committed: [['A', 'src/new.ts']] });
    expect(mod.gatherChangedFiles(git, REPO_ROOT, always, alwaysRef)).toEqual([
      'src/new.ts',
    ]);
  });

  it('gathers a staged change', () => {
    const { git } = fakeGit({ staged: [['M', 'src/staged.ts']] });
    expect(mod.gatherChangedFiles(git, REPO_ROOT, always, alwaysRef)).toEqual([
      'src/staged.ts',
    ]);
  });

  it('gathers an unstaged change', () => {
    const { git } = fakeGit({ unstaged: [['M', 'src/unstaged.ts']] });
    expect(mod.gatherChangedFiles(git, REPO_ROOT, always, alwaysRef)).toEqual([
      'src/unstaged.ts',
    ]);
  });

  it('gathers an untracked supported file and excludes ignored ones via git', () => {
    const { git, calls } = fakeGit({ untracked: ['src/untracked.ts'] });
    expect(mod.gatherChangedFiles(git, REPO_ROOT, always, alwaysRef)).toEqual([
      'src/untracked.ts',
    ]);
    // Ignored untracked files are dropped by git's --exclude-standard.
    expect(
      calls.some(
        (c) => c[0] === 'ls-files' && c.includes('--exclude-standard'),
      ),
    ).toBe(true);
  });

  it('excludes unsupported extensions and files no longer present', () => {
    const { git } = fakeGit({
      committed: [
        ['A', 'src/keep.ts'],
        ['A', 'db/skip.sql'],
      ],
      untracked: ['src/deleted-since.ts'],
    });
    const present = new Set([
      join(REPO_ROOT, 'src/keep.ts'),
      join(REPO_ROOT, 'db/skip.sql'),
    ]);
    expect(
      mod.gatherChangedFiles(git, REPO_ROOT, (f) => present.has(f), alwaysRef),
    ).toEqual(['src/keep.ts']);
  });

  it('deduplicates a file appearing in multiple sources', () => {
    const { git } = fakeGit({
      committed: [['A', 'src/dup.ts']],
      staged: [['M', 'src/dup.ts']],
      unstaged: [['M', 'src/dup.ts']],
      untracked: ['src/dup.ts'],
    });
    expect(mod.gatherChangedFiles(git, REPO_ROOT, always, alwaysRef)).toEqual([
      'src/dup.ts',
    ]);
  });

  it('keeps repository-root package.json and apps/backend/package.json distinct', () => {
    const probed: string[] = [];
    const fileExists = (p: string): boolean => {
      probed.push(p);
      return true;
    };
    const { git } = fakeGit({
      committed: [
        ['M', 'package.json'],
        ['M', 'apps/backend/package.json'],
      ],
    });
    const result = mod.gatherChangedFiles(
      git,
      REPO_ROOT,
      fileExists,
      alwaysRef,
    );
    expect(result).toEqual(['package.json', 'apps/backend/package.json']);
    // Each repo-relative path is resolved to its OWN absolute path — never
    // conflated with the other, and never resolved relative to some other cwd.
    expect(probed).toEqual([
      join(REPO_ROOT, 'package.json'),
      join(REPO_ROOT, 'apps/backend/package.json'),
    ]);
  });

  describe('checkWithPrettier against real files', () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'fmt-check-'));
    });
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('passes (0) with no files', () => {
      expect(mod.checkWithPrettier([], dir)).toBe(0);
    });

    it('passes (0) for a well-formatted file', () => {
      const file = join(dir, 'formatted.ts');
      writeFileSync(file, 'export const answer = 42;\n');
      expect(mod.checkWithPrettier([file], dir)).toBe(0);
    });

    it('fails (non-zero) for an unformatted file', () => {
      const file = join(dir, 'unformatted.ts');
      writeFileSync(file, 'export const  answer=42\n');
      expect(mod.checkWithPrettier([file], dir)).not.toBe(0);
    });
  });
});

/**
 * `gitRun` must fail CLOSED — throw `GitDiscoveryError` — for every failure
 * mode, and only ever return stdout on a genuinely successful (status 0) git
 * invocation. A `spawn` function is injected so every failure mode is
 * exercised deterministically, without depending on a real missing or broken
 * git binary.
 */
describe('gitRun (fail-closed git execution)', () => {
  it('returns stdout on a successful (status 0) invocation', () => {
    const spawn: SpawnFn = () => ({ status: 0, stdout: 'hello' });
    expect(mod.gitRun(['status'], undefined, spawn)).toBe('hello');
  });

  it('treats successful empty stdout as a valid empty result (not a failure)', () => {
    const spawn: SpawnFn = () => ({ status: 0, stdout: '' });
    expect(mod.gitRun(['status'], undefined, spawn)).toBe('');
  });

  it('fails closed on a non-zero exit status', () => {
    const spawn: SpawnFn = () => ({ status: 128, stdout: '' });
    expect(() => mod.gitRun(['status'], undefined, spawn)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('fails closed on a spawn error (e.g. git binary not found)', () => {
    const spawn: SpawnFn = () => ({
      status: null,
      error: Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }),
      stdout: '',
    });
    expect(() => mod.gitRun(['status'], undefined, spawn)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('fails closed when the command is terminated by a signal', () => {
    const spawn: SpawnFn = () => ({
      status: null,
      signal: 'SIGTERM',
      stdout: '',
    });
    expect(() => mod.gitRun(['status'], undefined, spawn)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('fails closed on a null or undefined exit status with no error/signal', () => {
    const nullStatus: SpawnFn = () => ({ status: null, stdout: '' });
    const undefinedStatus: SpawnFn = () =>
      ({ status: undefined, stdout: '' }) as unknown as SpawnResult;
    expect(() => mod.gitRun(['status'], undefined, nullStatus)).toThrow(
      mod.GitDiscoveryError,
    );
    expect(() => mod.gitRun(['status'], undefined, undefinedStatus)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('never leaks raw stderr content into the thrown error', () => {
    const spawn: SpawnFn = () => ({
      status: 1,
      stdout: '',
      stderr: 'possibly-sensitive-stderr-content',
    });
    let message = '';
    try {
      mod.gitRun(['status'], undefined, spawn);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('possibly-sensitive-stderr-content');
    // Safe metadata (the subcommand and a short reason) is still present.
    expect(message).toContain('status');
  });
});

describe('resolveRepoRoot (fails closed, independent of caller cwd)', () => {
  it('returns the trimmed toplevel path on success', () => {
    const spawn: SpawnFn = () => ({ status: 0, stdout: '/repo/root\n' });
    expect(mod.resolveRepoRoot(spawn)).toBe('/repo/root');
  });

  it('fails closed when git rev-parse fails (e.g. not a Git repository)', () => {
    const spawn: SpawnFn = () => ({ status: 128, stdout: '' });
    expect(() => mod.resolveRepoRoot(spawn)).toThrow(mod.GitDiscoveryError);
  });

  it('fails closed on empty output', () => {
    const spawn: SpawnFn = () => ({ status: 0, stdout: '' });
    expect(() => mod.resolveRepoRoot(spawn)).toThrow(mod.GitDiscoveryError);
  });
});

/**
 * `refExists` is the single primitive `resolveBase` uses to decide whether a
 * candidate ref may be skipped. It must distinguish "genuinely absent"
 * (`git show-ref` exit 1) from every operational failure — never inferring
 * absence from a caught exception. `spawn` is injected so every status/
 * error/signal combination is exercised deterministically.
 */
describe('refExists (status 0/1/other semantics)', () => {
  it('returns true on exit status 0 (ref exists)', () => {
    const spawn: SpawnFn = () => ({ status: 0, stdout: '' });
    expect(mod.refExists('refs/heads/main', undefined, spawn)).toBe(true);
  });

  it('returns false on exit status 1 (ref genuinely absent)', () => {
    const spawn: SpawnFn = () => ({ status: 1, stdout: '' });
    expect(mod.refExists('refs/remotes/origin/main', undefined, spawn)).toBe(
      false,
    );
  });

  it('fails closed on a spawn error', () => {
    const spawn: SpawnFn = () => ({
      status: null,
      error: Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }),
      stdout: '',
    });
    expect(() => mod.refExists('refs/heads/main', undefined, spawn)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('fails closed when terminated by a signal', () => {
    const spawn: SpawnFn = () => ({
      status: null,
      signal: 'SIGTERM',
      stdout: '',
    });
    expect(() => mod.refExists('refs/heads/main', undefined, spawn)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('fails closed on a null or undefined exit status', () => {
    const nullStatus: SpawnFn = () => ({ status: null, stdout: '' });
    const undefinedStatus: SpawnFn = () =>
      ({ status: undefined, stdout: '' }) as unknown as SpawnResult;
    expect(() =>
      mod.refExists('refs/heads/main', undefined, nullStatus),
    ).toThrow(mod.GitDiscoveryError);
    expect(() =>
      mod.refExists('refs/heads/main', undefined, undefinedStatus),
    ).toThrow(mod.GitDiscoveryError);
  });

  it('fails closed on any status other than 0 or 1 (e.g. 128 — repository corruption)', () => {
    const spawn: SpawnFn = () => ({ status: 128, stdout: '' });
    expect(() => mod.refExists('refs/heads/main', undefined, spawn)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('never leaks raw stderr content into the thrown error', () => {
    const spawn: SpawnFn = () => ({
      status: 128,
      stdout: '',
      stderr: 'possibly-sensitive-stderr-content',
    });
    let message = '';
    try {
      mod.refExists('refs/heads/main', undefined, spawn);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('possibly-sensitive-stderr-content');
    expect(message).toContain('show-ref');
  });
});

/**
 * `resolveBase` must never conflate "operational Git failure" with "ref
 * absent". Only `refExistsFn` returning `false` (i.e. a genuine `show-ref`
 * exit 1) permits trying the next candidate; a thrown error from
 * `refExistsFn`, or ANY failure from a `merge-base` call on a ref already
 * confirmed to exist, is immediately fatal — even when a later candidate
 * would otherwise have succeeded.
 */
describe('resolveBase (fail-closed ref selection and FORMAT_CHECK_BASE overrides)', () => {
  const ORIGINAL_ENV = process.env.FORMAT_CHECK_BASE;
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.FORMAT_CHECK_BASE;
    else process.env.FORMAT_CHECK_BASE = ORIGINAL_ENV;
  });

  function gitZForMergeBase(
    shas: Record<string, string>,
  ): (args: string[]) => string {
    return (args: string[]): string => {
      if (args[0] === 'merge-base') {
        const ref = args[args.length - 1];
        if (ref in shas) return shas[ref];
        throw new Error('unexpected merge-base ref: ' + ref);
      }
      throw new Error('unexpected call: ' + args.join(' '));
    };
  }

  it('1. prefers origin/main when it exists', () => {
    delete process.env.FORMAT_CHECK_BASE;
    const gitZ = gitZForMergeBase({ 'origin/main': 'ORIGIN_SHA\n' });
    const refExistsFn = (fullRef: string): boolean =>
      fullRef === 'refs/remotes/origin/main';
    expect(mod.resolveBase(gitZ, refExistsFn)).toBe('ORIGIN_SHA');
  });

  it('2. falls back to main when origin/main is genuinely absent', () => {
    delete process.env.FORMAT_CHECK_BASE;
    const gitZ = gitZForMergeBase({ main: 'MAIN_SHA\n' });
    const refExistsFn = (fullRef: string): boolean =>
      fullRef === 'refs/heads/main';
    expect(mod.resolveBase(gitZ, refExistsFn)).toBe('MAIN_SHA');
  });

  it('3. fails closed when neither origin/main nor main exists — never falls back to HEAD', () => {
    delete process.env.FORMAT_CHECK_BASE;
    const gitZ = (): string => {
      throw new Error('merge-base must never be called when no ref exists');
    };
    const refExistsFn = (): boolean => false;
    expect(() => mod.resolveBase(gitZ, refExistsFn)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('4-7. an operational failure checking origin/main is fatal (spawn error / signal / null status / non-zero status)', () => {
    delete process.env.FORMAT_CHECK_BASE;
    const gitZ = (): string => {
      throw new Error('merge-base must never be called after a fatal check');
    };
    for (const reason of [
      'spawn error (ENOENT)',
      'terminated by signal SIGTERM',
      'no exit status',
      'exit status 128',
    ]) {
      const refExistsFn = (): boolean => {
        throw new mod.GitDiscoveryError(
          ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/main'],
          reason,
        );
      };
      expect(() => mod.resolveBase(gitZ, refExistsFn)).toThrow(
        mod.GitDiscoveryError,
      );
    }
  });

  it('8. origin/main exists but its merge-base fails → fatal, even though main would succeed (regression)', () => {
    delete process.env.FORMAT_CHECK_BASE;
    let mainMergeBaseCalled = false;
    const gitZ = (args: string[]): string => {
      if (args[0] === 'merge-base' && args.includes('origin/main')) {
        throw new mod.GitDiscoveryError(args, 'exit status 1');
      }
      if (args[0] === 'merge-base' && args.includes('main')) {
        // A real bug would let this silently "rescue" the failed origin/main
        // lookup. It must NEVER be reached.
        mainMergeBaseCalled = true;
        return 'MAIN_SHA\n';
      }
      throw new Error('unexpected call: ' + args.join(' '));
    };
    // Both refs "exist" — origin/main's merge-base is simply broken.
    const refExistsFn = (): boolean => true;
    expect(() => mod.resolveBase(gitZ, refExistsFn)).toThrow(
      mod.GitDiscoveryError,
    );
    expect(mainMergeBaseCalled).toBe(false);
  });

  it('9. origin/main exists but its merge-base is signal-terminated → fatal', () => {
    delete process.env.FORMAT_CHECK_BASE;
    const gitZ = (args: string[]): string => {
      if (args[0] === 'merge-base' && args.includes('origin/main')) {
        throw new mod.GitDiscoveryError(args, 'terminated by signal SIGTERM');
      }
      throw new Error('main must never be consulted: ' + args.join(' '));
    };
    const refExistsFn = (fullRef: string): boolean =>
      fullRef === 'refs/remotes/origin/main';
    expect(() => mod.resolveBase(gitZ, refExistsFn)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('10. origin/main exists but its merge-base has a null exit status → fatal', () => {
    delete process.env.FORMAT_CHECK_BASE;
    const gitZ = (args: string[]): string => {
      if (args[0] === 'merge-base' && args.includes('origin/main')) {
        throw new mod.GitDiscoveryError(args, 'no exit status');
      }
      throw new Error('main must never be consulted: ' + args.join(' '));
    };
    const refExistsFn = (fullRef: string): boolean =>
      fullRef === 'refs/remotes/origin/main';
    expect(() => mod.resolveBase(gitZ, refExistsFn)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('11. an operational failure checking main (after origin/main is genuinely absent) is fatal', () => {
    delete process.env.FORMAT_CHECK_BASE;
    const gitZ = (): string => {
      throw new Error('merge-base must never be called');
    };
    const refExistsFn = (fullRef: string): boolean => {
      if (fullRef === 'refs/remotes/origin/main') return false; // genuinely absent
      throw new mod.GitDiscoveryError(
        ['show-ref', '--verify', '--quiet', fullRef],
        'exit status 128',
      );
    };
    expect(() => mod.resolveBase(gitZ, refExistsFn)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('12. main exists but its merge-base fails → fatal', () => {
    delete process.env.FORMAT_CHECK_BASE;
    const gitZ = (args: string[]): string => {
      if (args[0] === 'merge-base' && args.includes('main')) {
        throw new mod.GitDiscoveryError(args, 'exit status 128');
      }
      throw new Error('unexpected call: ' + args.join(' '));
    };
    const refExistsFn = (fullRef: string): boolean =>
      fullRef === 'refs/heads/main';
    expect(() => mod.resolveBase(gitZ, refExistsFn)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('13. only refExistsFn returning false (never a thrown error) permits trying the next candidate', () => {
    delete process.env.FORMAT_CHECK_BASE;
    let mainChecked = false;
    const gitZ = (): string => {
      throw new Error('merge-base must never be called');
    };
    const refExistsFn = (fullRef: string): boolean => {
      if (fullRef === 'refs/remotes/origin/main') {
        throw new mod.GitDiscoveryError(
          ['show-ref', '--verify', '--quiet', fullRef],
          'exit status 128',
        );
      }
      mainChecked = true;
      return true;
    };
    expect(() => mod.resolveBase(gitZ, refExistsFn)).toThrow(
      mod.GitDiscoveryError,
    );
    // main was never even checked — the thrown error short-circuited resolution.
    expect(mainChecked).toBe(false);
  });

  it('14. a valid explicit FORMAT_CHECK_BASE override is accepted without consulting origin/main or main', () => {
    process.env.FORMAT_CHECK_BASE = 'v1.0.0';
    const gitZ = (args: string[]): string => {
      if (args[0] === 'rev-parse' && args.includes('--verify')) {
        return 'TAG_SHA\n';
      }
      throw new Error('unexpected call: ' + args.join(' '));
    };
    const refExistsFn = (): boolean => {
      throw new Error('refExistsFn must not be consulted with an override set');
    };
    expect(mod.resolveBase(gitZ, refExistsFn)).toBe('TAG_SHA');
  });

  it('14b. an invalid explicit FORMAT_CHECK_BASE is fatal and never falls back to origin/main or main', () => {
    process.env.FORMAT_CHECK_BASE = 'not-a-real-ref';
    const gitZ = (args: string[]): string => {
      if (args[0] === 'rev-parse' && args.includes('--verify')) {
        throw new mod.GitDiscoveryError(args, 'exit status 128');
      }
      throw new Error(
        'unexpected call — must not try origin/main/main after an invalid override: ' +
          args.join(' '),
      );
    };
    const refExistsFn = (): boolean => {
      throw new Error('refExistsFn must not be consulted with an override set');
    };
    expect(() => mod.resolveBase(gitZ, refExistsFn)).toThrow(
      mod.GitDiscoveryError,
    );
  });

  it('15. errors never include raw Git stderr, file contents or secret values', () => {
    delete process.env.FORMAT_CHECK_BASE;
    const gitZ = (): string => {
      throw new Error('merge-base must never be called');
    };
    const refExistsFn = (): boolean => {
      throw new mod.GitDiscoveryError(
        ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/main'],
        'exit status 128', // safe metadata only — no raw stderr text
      );
    };
    let message = '';
    try {
      mod.resolveBase(gitZ, refExistsFn);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('show-ref');
    expect(message).not.toMatch(/fatal:|DATABASE_URL|password|secret/i);
  });
});

/**
 * `gatherChangedFiles` must abort the ENTIRE scan — not silently fall back to
 * a partial file list — when any of the four sources (committed, staged,
 * unstaged, untracked) fails to be discovered.
 */
describe('gatherChangedFiles aborts the whole scan when any listing fails', () => {
  const REPO_ROOT = '/repo';
  const always = (): boolean => true;
  const alwaysRef: RefExistsFn = () => true;

  it('aborts when committed-diff discovery fails', () => {
    const gitZ = (args: string[]): string => {
      if (args[0] === 'merge-base') return 'BASE_SHA';
      if (args[0] === 'diff' && args.includes('BASE_SHA')) {
        throw new mod.GitDiscoveryError(args, 'exit status 1');
      }
      return '';
    };
    expect(() =>
      mod.gatherChangedFiles(gitZ, REPO_ROOT, always, alwaysRef),
    ).toThrow(mod.GitDiscoveryError);
  });

  it('aborts when staged-diff discovery fails', () => {
    const gitZ = (args: string[]): string => {
      if (args[0] === 'merge-base') return 'BASE_SHA';
      if (args[0] === 'diff' && args.includes('--cached')) {
        throw new mod.GitDiscoveryError(args, 'exit status 1');
      }
      return '';
    };
    expect(() =>
      mod.gatherChangedFiles(gitZ, REPO_ROOT, always, alwaysRef),
    ).toThrow(mod.GitDiscoveryError);
  });

  it('aborts when unstaged-diff discovery fails', () => {
    const gitZ = (args: string[]): string => {
      if (args[0] === 'merge-base') return 'BASE_SHA';
      if (args[0] === 'diff' && args.includes('--cached')) return '';
      if (args[0] === 'diff' && args.includes('BASE_SHA')) return '';
      if (args[0] === 'diff') {
        throw new mod.GitDiscoveryError(args, 'exit status 1');
      }
      return '';
    };
    expect(() =>
      mod.gatherChangedFiles(gitZ, REPO_ROOT, always, alwaysRef),
    ).toThrow(mod.GitDiscoveryError);
  });

  it('aborts when untracked-file discovery fails', () => {
    const gitZ = (args: string[]): string => {
      if (args[0] === 'merge-base') return 'BASE_SHA';
      if (args[0] === 'ls-files') {
        throw new mod.GitDiscoveryError(args, 'exit status 1');
      }
      return '';
    };
    expect(() =>
      mod.gatherChangedFiles(gitZ, REPO_ROOT, always, alwaysRef),
    ).toThrow(mod.GitDiscoveryError);
  });
});

/**
 * CLI-level proof, over a disposable repository with a nested `apps/backend`
 * layout, that the gate is fully independent of the caller's working
 * directory — the exact defect the audit reproduced (three modified files,
 * gate reporting only one).
 */
describe('CLI: cwd-independent discovery over a disposable repository', () => {
  let repo: string;
  const SCRIPT = MODULE_PATH;

  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  };
  const write = (relPath: string, content: string): void => {
    const full = join(repo, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'voyagi-fmtcheck-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');

    write('package.json', '{"name":"root"}\n');
    write('apps/backend/package.json', '{"name":"backend"}\n');
    write('apps/backend/src/example.ts', 'export const ok = 1;\n');
    write('NOTES.md', '# Notes\n');
    write('.gitignore', 'ignored.txt\n');
    write('apps/backend/src/to-delete.ts', 'export const gone = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'seed');

    // Ignored file — must never be reported, even though it has a formatting issue.
    write('ignored.txt', 'export const bad=1\n');
    // Untracked file with a deliberate formatting issue.
    write('apps/backend/src/untracked.ts', 'export const bad=1\n');
    // Untracked file with spaces, a quote, and Unicode in the name — also
    // deliberately unformatted so it is visible in Prettier's own [warn] list
    // (a well-formatted file passes silently, which would prove nothing).
    write('apps/backend/src/weird name "quote"-é.ts', 'export const ok2=1\n');
    // A previously committed file, now deleted from the working tree.
    rmSync(join(repo, 'apps/backend/src/to-delete.ts'));
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  function run(cwdRelative: string): { status: number | null; out: string } {
    const result = spawnSync('node', [SCRIPT], {
      cwd: join(repo, cwdRelative),
      encoding: 'utf8',
    });
    return {
      status: result.status,
      out: `${result.stdout}\n${result.stderr}`,
    };
  }

  function countOf(out: string): number {
    const match = /checking (\d+) changed file/.exec(out);
    return match ? Number(match[1]) : -1;
  }

  it('discovers the same changed-file count from the repo root and a nested apps/backend cwd', () => {
    const fromRoot = run('.');
    const fromNested = run('apps/backend');

    expect(countOf(fromRoot.out)).toBeGreaterThan(0);
    expect(countOf(fromRoot.out)).toBe(countOf(fromNested.out));
  });

  it('a formatting error in a discovered file causes a non-zero exit (both cwds)', () => {
    const fromRoot = run('.');
    const fromNested = run('apps/backend');
    expect(fromRoot.status).not.toBe(0);
    expect(fromNested.status).not.toBe(0);
  });

  it('includes an untracked file with spaces, a quote and Unicode in its name', () => {
    const { out } = run('.');
    expect(out).toContain('weird name "quote"-é.ts');
  });

  it('never reports the ignored or deleted files', () => {
    const { out } = run('.');
    expect(out).not.toContain('ignored.txt');
    expect(out).not.toContain('to-delete.ts');
  });

  it('never leaks raw git stderr (e.g. no "fatal:" prefix) into normal output', () => {
    const { out } = run('.');
    expect(out).not.toMatch(/fatal:/i);
  });
});

/**
 * Reproduces the scenario the independent audit used to demonstrate the prior
 * fail-OPEN defect for the secret scanner, now applied to format-check: git
 * repository discovery cannot succeed. The gate must fail CLOSED.
 */
describe('CLI fails closed when Git repository discovery fails', () => {
  it('a non-Git directory: exits non-zero and never claims success', () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), 'voyagi-fmtcheck-nogit-'));
    try {
      writeFileSync(join(nonGitDir, 'placeholder.txt'), 'nothing here\n');
      const result = spawnSync('node', [MODULE_PATH], {
        cwd: nonGitDir,
        encoding: 'utf8',
      });
      const out = `${result.stdout}\n${result.stderr}`;

      expect(result.status).not.toBe(0);
      expect(out).not.toMatch(/no changed Prettier-supported files/);
      expect(out).not.toMatch(/checking \d+ changed file/);
      expect(out).toMatch(/unable to discover changed files/);
      expect(out).toMatch(/check aborted/);
      // No raw git stderr (e.g. "fatal: not a git repository") leaks through.
      expect(out).not.toMatch(/fatal:/i);
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});
