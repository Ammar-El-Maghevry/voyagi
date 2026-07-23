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

const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');

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

/** Resolve the merge base of HEAD with `main` (prefers origin/main in CI). */
function resolveBase(gitZ) {
  if (process.env.FORMAT_CHECK_BASE) return process.env.FORMAT_CHECK_BASE;
  for (const ref of ['origin/main', 'main']) {
    const out = gitZ(['merge-base', 'HEAD', ref]).trim();
    if (out) return out;
  }
  // Fallback: compare against HEAD (committed set empty); staged/unstaged/
  // untracked sources still make the local gate meaningful.
  return 'HEAD';
}

/**
 * Gather the deduplicated set of supported, existing files changed by this
 * branch, from every source:
 *  - committed:  merge-base(main, HEAD) → HEAD
 *  - staged:     index vs HEAD
 *  - unstaged:   working tree vs index
 *  - untracked:  new, non-ignored files (`--exclude-standard` drops ignored)
 * `gitZ(args) -> string` is injectable so the logic is fully unit-testable.
 */
function gatherChangedFiles(gitZ, fileExists = existsSync) {
  const base = resolveBase(gitZ);
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
    if (isSupported(file) && fileExists(file)) result.push(file);
  }
  return result;
}

/** Real git runner: returns stdout on success, '' on failure (never throws). */
function makeGitZ() {
  return (args) => {
    const result = spawnSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return result.status === 0 && typeof result.stdout === 'string'
      ? result.stdout
      : '';
  };
}

/** Run prettier --check against an explicit, shell-safe argv of files. */
function checkWithPrettier(files) {
  if (files.length === 0) return 0;
  const prettierBin = require.resolve('prettier/bin/prettier.cjs');
  const result = spawnSync(
    process.execPath,
    [prettierBin, '--check', ...files],
    { stdio: 'inherit' },
  );
  return result.status === null ? 1 : result.status;
}

function main() {
  const files = gatherChangedFiles(makeGitZ());
  if (files.length === 0) {
    console.log('format-check: no changed Prettier-supported files to check.');
    process.exit(0);
  }
  console.log(`format-check: checking ${files.length} changed file(s).`);
  process.exit(checkWithPrettier(files));
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  isSupported,
  parseNameStatusZ,
  parseZList,
  resolveBase,
  gatherChangedFiles,
  checkWithPrettier,
  main,
};

if (require.main === module) main();
