#!/usr/bin/env node
// Deterministic, offline secret scanner for tracked repository files.
//
// It reports only safe metadata (file path, 1-based line number, rule name) and
// NEVER prints the matched value. It detects private keys, common cloud access
// keys, obvious provider/CI tokens, and credentialed non-local database URLs.
// Local development database URLs (127.0.0.1 / localhost / ::1) are intentional
// test fixtures and are not findings. Exit code is non-zero when any finding
// survives the minimal, explicit allowlist.

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

function trackedFiles() {
  const result = spawnSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) return [];
  return result.stdout.split('\0').filter((f) => f.length > 0);
}

function main() {
  const files = trackedFiles().filter(shouldScan);
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
      `security:secrets: scanned ${files.length} tracked files, no findings.`,
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
};

if (require.main === module) main();
