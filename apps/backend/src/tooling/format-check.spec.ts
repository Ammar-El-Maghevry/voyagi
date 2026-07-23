import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The format-check gate is a CommonJS script under `scripts/`. Load it via a
 * computed `require` path (non-literal, so TypeScript performs no module
 * resolution on the untyped `.cjs`). `process.cwd()` is `apps/backend` under
 * `pnpm test`.
 */
interface FormatCheckModule {
  isSupported(file: string): boolean;
  parseNameStatusZ(output: string): string[];
  parseZList(output: string): string[];
  gatherChangedFiles(
    gitZ: (args: string[]) => string,
    fileExists?: (f: string) => boolean,
  ): string[];
  checkWithPrettier(files: string[]): number;
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
    expect(mod.gatherChangedFiles(git, always)).toEqual(['src/new.ts']);
  });

  it('gathers a staged change', () => {
    const { git } = fakeGit({ staged: [['M', 'src/staged.ts']] });
    expect(mod.gatherChangedFiles(git, always)).toEqual(['src/staged.ts']);
  });

  it('gathers an unstaged change', () => {
    const { git } = fakeGit({ unstaged: [['M', 'src/unstaged.ts']] });
    expect(mod.gatherChangedFiles(git, always)).toEqual(['src/unstaged.ts']);
  });

  it('gathers an untracked supported file and excludes ignored ones via git', () => {
    const { git, calls } = fakeGit({ untracked: ['src/untracked.ts'] });
    expect(mod.gatherChangedFiles(git, always)).toEqual(['src/untracked.ts']);
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
    const present = new Set(['src/keep.ts', 'db/skip.sql']);
    expect(mod.gatherChangedFiles(git, (f) => present.has(f))).toEqual([
      'src/keep.ts',
    ]);
  });

  it('deduplicates a file appearing in multiple sources', () => {
    const { git } = fakeGit({
      committed: [['A', 'src/dup.ts']],
      staged: [['M', 'src/dup.ts']],
      unstaged: [['M', 'src/dup.ts']],
      untracked: ['src/dup.ts'],
    });
    expect(mod.gatherChangedFiles(git, always)).toEqual(['src/dup.ts']);
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
      expect(mod.checkWithPrettier([])).toBe(0);
    });

    it('passes (0) for a well-formatted file', () => {
      const file = join(dir, 'formatted.ts');
      writeFileSync(file, 'export const answer = 42;\n');
      expect(mod.checkWithPrettier([file])).toBe(0);
    });

    it('fails (non-zero) for an unformatted file', () => {
      const file = join(dir, 'unformatted.ts');
      writeFileSync(file, 'export const  answer=42\n');
      expect(mod.checkWithPrettier([file])).not.toBe(0);
    });
  });
});
