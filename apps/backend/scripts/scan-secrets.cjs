#!/usr/bin/env node
// Deterministic, offline secret scanner for repository files.
//
// It scans the full working set — tracked files (including staged and unstaged
// modifications, since content is read from the working tree) and untracked,
// non-ignored files — so uncommitted work is covered by the same gate that runs
// in CI. Deleted and git-ignored files are excluded. Paths are handled via
// NUL-delimited git output, so spaces, quotes and Unicode are safe. It reports
// only safe metadata (file path, 1-based line number, rule name) and NEVER
// prints the matched value. It detects private keys, common cloud access keys,
// obvious provider/CI tokens, and credentialed non-local database URLs. Local
// development database URLs (127.0.0.1 / localhost / ::1) are intentional test
// fixtures and are not findings. Exit code is non-zero when any finding survives
// the minimal, explicit allowlist.

const { spawnSync } = require('node:child_process');
const { readFileSync, existsSync, statSync } = require('node:fs');

/** Rules: each matches a *shape* of secret. Values are never logged. */
const SECRET_RULES = Object.freeze([
  {
    name: 'private-key',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  },
  { name: 'aws-access-key-id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'slack-token', regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'github-token', regex: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/ },
  {
    name: 'credentialed-db-url',
    regex:
      /\b(?:postgres(?:ql)?|mysql|mongodb)(?:\+srv)?:\/\/[^\s:@/]+:[^\s:@/]+@([^\s:/]+)/,
  },
]);

/** Extensions worth scanning (text/config/source). */
const SCANNED_EXTENSIONS = Object.freeze([
  '.ts',
  '.js',
  '.cjs',
  '.mjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.sql',
  '.sh',
  '.txt',
  '.example',
  '.env',
]);

/** Files never scanned (large generated content with no hand-written secrets). */
const SKIP_FILES = Object.freeze([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
]);

const LOCAL_DB_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '::1']);

function shouldScan(file) {
  const base = file.split('/').pop() ?? file;
  if (SKIP_FILES.includes(base)) return false;
  const lower = file.toLowerCase();
  return (
    SCANNED_EXTENSIONS.some((ext) => lower.endsWith(ext)) ||
    base.startsWith('.env')
  );
}

/**
 * A credentialed DB URL is treated as a documented test fixture (not a finding)
 * only when its host is local (127.0.0.1 / localhost / ::1) or a single-label
 * host (no dot, e.g. `db`, `postgres`) — which cannot be a routable production
 * FQDN. Real multi-label hosts (e.g. `db.prod.example.com`) are always reported.
 */
function isAllowed(rule, matchGroups) {
  if (rule === 'credentialed-db-url') {
    const host = matchGroups?.[1];
    if (host === undefined) return false;
    return LOCAL_DB_HOSTS.includes(host) || !host.includes('.');
  }
  return false;
}

/** Scan text; return safe findings [{ line, rule }] with no secret values. */
function scanText(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const { name, regex } of SECRET_RULES) {
      const match = regex.exec(lines[i]);
      if (match && !isAllowed(name, match)) {
        findings.push({ line: i + 1, rule: name });
      }
    }
  }
  return findings;
}

/**
 * Thrown when Git repository-state discovery cannot be trusted (the scanner
 * must fail closed rather than silently scanning an incomplete file list).
 * Carries only safe metadata — the git subcommand and a short failure reason —
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
 * Run a NUL-delimited git listing. Fails closed: any spawn error, signal
 * termination, missing/null exit status, or non-zero exit status throws a
 * {@link GitDiscoveryError} instead of degrading to an empty list. A command
 * that legitimately exits 0 with empty stdout (e.g. a repo with no untracked
 * files) still returns a valid empty array — only a failed listing is fatal.
 *
 * `spawn` is injectable so tests can simulate every failure mode without a
 * real missing/broken git binary.
 */
function gitListZ(args, spawn = spawnSync) {
  const result = spawn('git', args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
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
  return result.stdout.split('\0').filter((f) => f.length > 0);
}

/**
 * Merge tracked and untracked listings into a deduplicated, sorted set of
 * candidate paths. Pure so it can be unit-tested with fixed listings.
 */
function collectScanTargets(tracked, others) {
  return [...new Set([...tracked, ...others])].sort();
}

/**
 * Working-set files to scan: tracked (working-tree content includes staged and
 * unstaged edits) plus untracked, non-ignored files. `--exclude-standard`
 * omits git-ignored paths; deleted files are dropped later by the existence
 * check. Both listings must succeed — a partial result (e.g. tracked files
 * resolved but untracked discovery failed) is never scanned as if it were
 * complete; see {@link gitListZ}.
 */
function workingSetFiles(spawn = spawnSync) {
  const tracked = gitListZ(['ls-files', '-z'], spawn);
  const others = gitListZ(
    ['ls-files', '-z', '--others', '--exclude-standard'],
    spawn,
  );
  return collectScanTargets(tracked, others);
}

function main() {
  let files;
  try {
    files = workingSetFiles().filter(shouldScan);
  } catch (error) {
    // Fail closed: repository-state discovery could not be trusted, so no
    // scan was performed. Never report a clean/zero-file result here.
    const detail =
      error instanceof GitDiscoveryError
        ? ` (${error.args.join(' ')}: ${error.reason})`
        : '';
    console.error(
      `security:secrets: unable to discover repository files; scan aborted.${detail}`,
    );
    process.exit(2);
  }

  const findings = [];
  for (const file of files) {
    if (!existsSync(file) || statSync(file).isDirectory()) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const finding of scanText(text)) {
      findings.push({ file, ...finding });
    }
  }

  if (findings.length === 0) {
    console.log(
      `security:secrets: scanned ${files.length} working-set files (tracked + staged + unstaged + untracked), no findings.`,
    );
    process.exit(0);
  }
  console.error(
    `security:secrets: ${findings.length} potential secret(s) found:`,
  );
  for (const f of findings) {
    // Metadata only — the matched value is intentionally never printed.
    console.error(`  ${f.file}:${f.line} [${f.rule}]`);
  }
  process.exit(1);
}

module.exports = {
  SECRET_RULES,
  SCANNED_EXTENSIONS,
  shouldScan,
  isAllowed,
  scanText,
  collectScanTargets,
  workingSetFiles,
  gitListZ,
  GitDiscoveryError,
};

if (require.main === module) main();
