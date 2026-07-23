import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JOURNEYS, type TestRef } from './support/journeys/journey-manifest';

/**
 * Machine-checkable verification of the fourteen-journey manifest. It does not
 * re-run the journeys; it proves the manifest maps every journey to REAL tests
 * that still exist. It fails when:
 *   - the manifest does not describe exactly journeys 1..14;
 *   - a journey has no e2e proof, or a DB-authoritative journey has no
 *     integration proof;
 *   - a referenced test file does not exist;
 *   - a referenced test title is no longer present in that file;
 *   - a referenced migration file is missing.
 * (Runs under the integration config but needs no database.)
 */

const BACKEND_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(BACKEND_ROOT, '..', '..', 'supabase', 'migrations');

function fileContains(ref: TestRef): { exists: boolean; hasTitle: boolean } {
  const path = join(BACKEND_ROOT, ref.file);
  if (!existsSync(path)) return { exists: false, hasTitle: false };
  const content = readFileSync(path, 'utf8');
  return { exists: true, hasTitle: content.includes(ref.title) };
}

function migrationExists(substring: string): boolean {
  return readdirSync(MIGRATIONS_DIR).some((f) => f.includes(substring));
}

describe('Fourteen critical-journey manifest', () => {
  it('describes exactly journeys 1..14 with unique ids and names', () => {
    expect(JOURNEYS).toHaveLength(14);
    expect(JOURNEYS.map((j) => j.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    expect(new Set(JOURNEYS.map((j) => j.name)).size).toBe(14);
  });

  it('gives every journey at least one e2e proof and named steps', () => {
    for (const journey of JOURNEYS) {
      expect(journey.e2e.length).toBeGreaterThanOrEqual(1);
      expect(journey.steps.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('requires an integration proof for every DB-authoritative journey', () => {
    for (const journey of JOURNEYS) {
      if (journey.requiresIntegration) {
        expect(journey.integration.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  describe('every referenced e2e test exists', () => {
    const refs = JOURNEYS.flatMap((j) =>
      j.e2e.map((ref) => ({ journey: j.name, ...ref })),
    );
    it.each(refs)('journey "$journey" → $file :: "$title"', (ref) => {
      const result = fileContains(ref);
      expect(result.exists).toBe(true);
      expect(result.hasTitle).toBe(true);
    });
  });

  describe('every referenced integration/concurrency test exists', () => {
    const refs = JOURNEYS.flatMap((j) =>
      j.integration.map((ref) => ({ journey: j.name, ...ref })),
    );
    it.each(refs)('journey "$journey" → $file :: "$title"', (ref) => {
      const result = fileContains(ref);
      expect(result.exists).toBe(true);
      expect(result.hasTitle).toBe(true);
    });
  });

  describe('every referenced migration constraint exists', () => {
    const refs = JOURNEYS.flatMap((j) =>
      j.migrations.map((m) => ({ journey: j.name, migration: m })),
    );
    it.each(refs)(
      'journey "$journey" → migration $migration',
      ({ migration }) => {
        expect(migrationExists(migration)).toBe(true);
      },
    );
  });

  it('no journey is backed only by a mock/helper test (real e2e or PostgreSQL files)', () => {
    for (const journey of JOURNEYS) {
      const allRefs = [...journey.e2e, ...journey.integration];
      // Every proof lives in a real e2e or integration spec, not an in-memory helper.
      for (const ref of allRefs) {
        expect(ref.file).toMatch(/\.(e2e|integration)-spec\.ts$/);
        expect(ref.file).not.toMatch(/in-memory|support\//);
      }
    }
  });
});
