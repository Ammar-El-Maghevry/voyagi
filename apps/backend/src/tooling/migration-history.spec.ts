import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Migration-history validation guardrail.
 *
 * Phase 16/17 introduce NO migration, so this branch must not add or edit any
 * file under `supabase/migrations`. It also asserts the historical set stays
 * deterministic, uniquely numbered/timestamped, and that security-definer
 * functions pin a safe `search_path`.
 */
const REPO_ROOT = resolve(process.cwd(), '..', '..');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'supabase', 'migrations');

const FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const NAME = /^(\d{14})_(\d{3})_[a-z0-9_]+\.sql$/;

function git(args: string[]): { status: number; stdout: string } {
  const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return { status: r.status ?? 1, stdout: r.stdout ?? '' };
}

describe('migration history', () => {
  it('has the expected 17 migrations and no migration 018', () => {
    expect(FILES.length).toBe(17);
    expect(FILES.some((f) => /_018_/.test(f))).toBe(false);
    expect(
      FILES.some((f) => /_017_maintenance_commissions_engine\.sql$/.test(f)),
    ).toBe(true);
  });

  it('every filename matches the timestamp_sequence_name convention', () => {
    for (const file of FILES) expect(file).toMatch(NAME);
  });

  it('has unique, strictly increasing timestamps aligned with sequence numbers', () => {
    const timestamps = FILES.map((f) => f.match(NAME)![1]);
    const sequences = FILES.map((f) => f.match(NAME)![2]);
    expect(new Set(timestamps).size).toBe(FILES.length);
    // Lexical filename order (already sorted) must be strictly increasing by ts.
    for (let i = 1; i < timestamps.length; i += 1) {
      expect(timestamps[i] > timestamps[i - 1]).toBe(true);
    }
    // Sequence numbers are 001..017 in order.
    expect(sequences).toEqual(
      Array.from({ length: 17 }, (_, i) => String(i + 1).padStart(3, '0')),
    );
  });

  it('every security-definer function pins an empty search_path', () => {
    for (const file of FILES) {
      const sql = readFileSync(
        resolve(MIGRATIONS_DIR, file),
        'utf8',
      ).toLowerCase();
      const definerCount = (sql.match(/security definer/g) ?? []).length;
      if (definerCount === 0) continue;
      const safePathCount = (sql.match(/set search_path\s*=\s*''/g) ?? [])
        .length;
      // Each security-definer function body must set an empty search_path.
      expect(safePathCount).toBeGreaterThanOrEqual(definerCount);
    }
  });

  it('this branch does not add, edit, or delete any migration file', () => {
    // Committed changes vs merge base.
    const base = git(['merge-base', 'HEAD', 'main']).stdout.trim() || 'HEAD';
    const committed = git([
      'diff',
      '--name-only',
      base,
      'HEAD',
      '--',
      'supabase/migrations',
    ]);
    // Uncommitted (staged + unstaged + untracked) changes.
    const working = git(['status', '--porcelain', '--', 'supabase/migrations']);
    expect(committed.stdout.trim()).toBe('');
    expect(working.stdout.trim()).toBe('');
  });
});
