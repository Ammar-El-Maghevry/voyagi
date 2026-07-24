#!/usr/bin/env node
// Forward-only Prettier quality gate.
//
// Runs `prettier --check` ONLY on files this branch adds/changes — never the
// whole repository. ~200 pre-existing files do not yet satisfy the repository
// Prettier config, so a repo-wide `prettier --check` would fail on unrelated
// history; full-repo normalization is deferred to a separate formatting-only PR.
// `pnpm lint` (ESLint, zero warnings) remains the enforced whole-repo style
// gate; this gate is complementary.
//
// It is meaningful both in CI (committed branch changes vs the merge base with
// main) AND locally before a commit (staged + unstaged + untracked, non-ignored
// files). Non-mutating; no shell interpolation (git output is NUL-delimited,
// prettier is spawned with an argv array); exits 0 when no applicable file
// changed.
//
// CWD-independent: `git diff`/`git ls-files` report paths relative to the
// repository ROOT regardless of the invoking working directory, so the script
// resolves the repo root once (`git rev-parse --show-toplevel`) and uses it
// both to run every git command (`cwd`) and to resolve file existence
// (absolute path), so it behaves identically whether launched from the repo
// root, `apps/backend`, or any other subdirectory. Repository-root-relative
// paths (e.g. `package.json` vs `apps/backend/package.json`) are never
// conflated: existence and Prettier both operate on the resolved absolute
// path / the repo-root-relative path passed with `cwd` set to the root.
//
// Fails CLOSED: every git operation this script depends on (repo-root
// discovery, merge-base discovery, committed/staged/unstaged diff, untracked
// listing) throws on any spawn error, signal termination, missing exit status,
// or non-zero exit status — never degrades to an empty result. An explicit but
// invalid `FORMAT_CHECK_BASE` override fails rather than being silently
// ignored, and a merge-base that cannot be resolved against `origin/main` or
// `main` aborts the gate instead of silently comparing against `HEAD`.

const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

/** File extensions the repository Prettier configuration formats. */
const SUPPORTED_EXTENSIONS = Object.freeze([
  '.ts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
]);

/** Whether Prettier should format a given path (by extension). */
function isSupported(file) {
  const lower = file.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Parse `git ... -z --name-status` output into the resulting file paths.
 * NUL-delimited, so spaces/quotes/Unicode in filenames are safe. Rename/copy
 * records carry two paths (old, new); the NEW (destination) path is taken.
 * Deletions (`D`) are explicitly excluded so a removed file is never checked.
 */
function parseNameStatusZ(output) {
  const tokens = output.split('\0').filter((token) => token.length > 0);
  const files = [];
  let index = 0;
  while (index < tokens.length) {
    const status = tokens[index++];
    if (status === undefined) break;
    const code = status[0];
    if (code === 'R' || code === 'C') {
      index++; // skip old path
      const newPath = tokens[index++];
      if (newPath) files.push(newPath);
    } else if (code === 'D') {
      index++; // consume the deleted path but do not include it
    } else {
      const path = tokens[index++];
      if (path) files.push(path);
    }
  }
  return files;
}

/** Parse a plain NUL-delimited path list (e.g. `git ls-files -z`). */
function parseZList(output) {
  return output.split('\0').filter((token) => token.length > 0);
}

/**
 * Thrown when a required Git operation cannot be trusted (repo-root
 * discovery, merge-base resolution, or any diff/listing this gate depends
 * on). Carries only safe metadata — the git subcommand and a short reason —
 * never raw stdout/stderr, which could echo unrelated file contents.
 */
class GitDiscoveryError extends Error {
  constructor(args, reason) {
    super(`git ${args.join(' ')} failed: ${reason}`);
    this.name = 'GitDiscoveryError';
    this.args = args;
    this.reason = reason;
  }
}

/**
 * Run a git command and return its raw stdout. Fails CLOSED: any spawn error,
 * signal termination, missing/null exit status, or non-zero exit status throws
 * {@link GitDiscoveryError} instead of degrading to an empty string. A command
 * that legitimately exits 0 with empty stdout is a valid empty result — only a
 * failed invocation is fatal. `spawn` is injectable so every failure mode is
 * unit-testable without a real missing/broken git binary.
 */
function gitRun(args, options, spawn = spawnSync) {
  const result = spawn('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) {
    throw new GitDiscoveryError(
      args,
      `spawn error (${result.error.code ?? result.error.message ?? 'unknown'})`,
    );
  }
  if (result.signal) {
    throw new GitDiscoveryError(args, `terminated by signal ${result.signal}`);
  }
  if (result.status === null || result.status === undefined) {
    throw new GitDiscoveryError(args, 'no exit status');
  }
  if (result.status !== 0) {
    throw new GitDiscoveryError(args, `exit status ${result.status}`);
  }
  return typeof result.stdout === 'string' ? result.stdout : '';
}

/**
 * Resolve the repository root via `git rev-parse --show-toplevel`. Works from
 * any cwd inside the repository (git walks up to find the top level), so the
 * caller's launch directory never matters. Fails closed if discovery fails
 * (e.g. not inside a Git repository) or returns empty output.
 */
function resolveRepoRoot(spawn = spawnSync) {
  const args = ['rev-parse', '--show-toplevel'];
  const out = gitRun(args, undefined, spawn).trim();
  if (!out) {
    throw new GitDiscoveryError(args, 'empty output');
  }
  return out;
}

/**
 * Check whether a fully-qualified ref (e.g. `refs/remotes/origin/main`)
 * exists, via `git show-ref --verify --quiet <ref>`. This is the ONLY
 * primitive `resolveBase` uses to decide "try the next candidate ref" versus
 * "fail closed" — it never infers ref absence from a caught exception:
 *  - exit status 0 → the ref exists (`true`);
 *  - exit status 1 → the ref genuinely does not exist (`false`) — the ONLY
 *    outcome that permits a caller to fall back to another candidate;
 *  - a spawn error, signal termination, missing/null exit status, or ANY
 *    other exit status is an operational Git failure and throws
 *    {@link GitDiscoveryError} — it is NEVER interpreted as "ref absent".
 */
function refExists(fullRef, options, spawn = spawnSync) {
  const args = ['show-ref', '--verify', '--quiet', fullRef];
  const result = spawn('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) {
    throw new GitDiscoveryError(
      args,
      `spawn error (${result.error.code ?? result.error.message ?? 'unknown'})`,
    );
  }
  if (result.signal) {
    throw new GitDiscoveryError(args, `terminated by signal ${result.signal}`);
  }
  if (result.status === null || result.status === undefined) {
    throw new GitDiscoveryError(args, 'no exit status');
  }
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new GitDiscoveryError(args, `exit status ${result.status}`);
}

/**
 * Candidate refs tried, in order, when no explicit `FORMAT_CHECK_BASE` is set.
 * `fullRef` is what {@link refExists} checks; `ref` is what `merge-base` uses.
 */
const BASE_CANDIDATES = Object.freeze([
  { ref: 'origin/main', fullRef: 'refs/remotes/origin/main' },
  { ref: 'main', fullRef: 'refs/heads/main' },
]);

/**
 * Resolve the merge-base of HEAD with `main` (prefers `origin/main`). Fails
 * CLOSED:
 *  - an explicit `FORMAT_CHECK_BASE` override must resolve to a real commit —
 *    an invalid override throws rather than being silently ignored, and never
 *    falls back to origin/main or main;
 *  - candidate selection uses `refExistsFn` (backed by {@link refExists}) to
 *    distinguish "ref genuinely absent" from an operational failure — ONLY a
 *    genuinely absent ref permits trying the next candidate; a `show-ref`
 *    operational failure is immediately fatal;
 *  - once a candidate ref is confirmed to exist, its `merge-base` MUST
 *    succeed — that call is never wrapped in try/catch, so any failure (a
 *    spawn error, signal, non-zero status, or empty output) propagates as a
 *    fatal error instead of silently falling through to the next candidate;
 *  - if neither `origin/main` nor `main` exists, the gate aborts rather than
 *    silently comparing against `HEAD` (which would hide the committed diff).
 */
function resolveBase(gitZ, refExistsFn) {
  const override = process.env.FORMAT_CHECK_BASE;
  if (override) {
    const args = ['rev-parse', '--verify', `${override}^{commit}`];
    let sha = '';
    try {
      sha = gitZ(args).trim();
    } catch {
      sha = '';
    }
    if (!sha) {
      throw new GitDiscoveryError(
        args,
        `FORMAT_CHECK_BASE "${override}" does not resolve to a commit`,
      );
    }
    return sha;
  }
  for (const { ref, fullRef } of BASE_CANDIDATES) {
    // The ONLY sanctioned reason to try the next candidate: the ref genuinely
    // does not exist (refExistsFn returns false). Any operational failure
    // here throws and is fatal — it is never caught to mean "absent".
    if (!refExistsFn(fullRef)) continue;
    // The ref exists — its merge-base MUST now succeed. This call is
    // deliberately NOT wrapped in try/catch: any failure propagates as a
    // fatal GitDiscoveryError rather than silently falling through.
    const out = gitZ(['merge-base', 'HEAD', ref]).trim();
    if (!out) {
      throw new GitDiscoveryError(
        ['merge-base', 'HEAD', ref],
        'empty merge-base output',
      );
    }
    return out;
  }
  throw new GitDiscoveryError(
    ['show-ref', 'refs/remotes/origin/main', 'refs/heads/main'],
    'no valid merge-base could be resolved (neither origin/main nor main exists)',
  );
}

/**
 * Gather the deduplicated set of supported, existing files changed by this
 * branch, from every source:
 *  - committed:  merge-base(main, HEAD) → HEAD
 *  - staged:     index vs HEAD
 *  - unstaged:   working tree vs index
 *  - untracked:  new, non-ignored files (`--exclude-standard` drops ignored)
 *
 * `gitZ(args) -> string` already runs with `cwd` fixed to the repository root
 * (see {@link makeGitZ}), so every path it returns is repo-root-relative
 * regardless of the caller's working directory. File existence is resolved
 * against `repoRoot` explicitly, so a repo-root path like `package.json` is
 * never confused with `apps/backend/package.json`. `refExistsFn` defaults to
 * the real {@link refExists} pinned to `repoRoot`, matching the `fileExists`
 * default; tests inject their own to avoid depending on a real git checkout.
 */
function gatherChangedFiles(
  gitZ,
  repoRoot,
  fileExists = existsSync,
  refExistsFn = (fullRef) => refExists(fullRef, { cwd: repoRoot }),
) {
  const base = resolveBase(gitZ, refExistsFn);
  const committed = parseNameStatusZ(
    gitZ(['diff', '--diff-filter=ACMR', '-z', '--name-status', base, 'HEAD']),
  );
  const staged = parseNameStatusZ(
    gitZ(['diff', '--cached', '--diff-filter=ACMR', '-z', '--name-status']),
  );
  const unstaged = parseNameStatusZ(
    gitZ(['diff', '--diff-filter=ACMR', '-z', '--name-status']),
  );
  const untracked = parseZList(
    gitZ(['ls-files', '--others', '--exclude-standard', '-z']),
  );

  const seen = new Set();
  const result = [];
  for (const file of [...committed, ...staged, ...unstaged, ...untracked]) {
    if (seen.has(file)) continue;
    seen.add(file);
    if (isSupported(file) && fileExists(join(repoRoot, file))) {
      result.push(file);
    }
  }
  return result;
}

/** Build a repo-root-pinned git runner: every call runs with `cwd: repoRoot`. */
function makeGitZ(repoRoot, spawn = spawnSync) {
  return (args) => gitRun(args, { cwd: repoRoot }, spawn);
}

/**
 * Run prettier --check against an explicit, shell-safe argv of repo-root-
 * relative files, executed with `cwd: repoRoot` so the paths resolve
 * correctly regardless of the caller's working directory.
 */
function checkWithPrettier(files, repoRoot) {
  if (files.length === 0) return 0;
  const prettierBin = require.resolve('prettier/bin/prettier.cjs');
  const result = spawnSync(
    process.execPath,
    [prettierBin, '--check', ...files],
    { stdio: 'inherit', cwd: repoRoot },
  );
  return result.status === null ? 1 : result.status;
}

function main() {
  let files;
  let repoRoot;
  try {
    repoRoot = resolveRepoRoot();
    const gitZ = makeGitZ(repoRoot);
    files = gatherChangedFiles(gitZ, repoRoot);
  } catch (error) {
    // Fail closed: changed-file discovery could not be trusted, so no check
    // was performed. Never report a clean/zero-file result here.
    const detail =
      error instanceof GitDiscoveryError
        ? ` (${error.args.join(' ')}: ${error.reason})`
        : '';
    console.error(
      `format-check: unable to discover changed files; check aborted.${detail}`,
    );
    process.exit(2);
  }

  if (files.length === 0) {
    console.log('format-check: no changed Prettier-supported files to check.');
    process.exit(0);
  }
  console.log(`format-check: checking ${files.length} changed file(s).`);
  process.exit(checkWithPrettier(files, repoRoot));
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  isSupported,
  parseNameStatusZ,
  parseZList,
  resolveBase,
  resolveRepoRoot,
  refExists,
  BASE_CANDIDATES,
  gatherChangedFiles,
  makeGitZ,
  checkWithPrettier,
  gitRun,
  GitDiscoveryError,
  main,
};

if (require.main === module) main();
