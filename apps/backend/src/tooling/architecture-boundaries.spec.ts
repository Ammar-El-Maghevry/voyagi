import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Architecture boundary guardrails (static import/source graph).
 *
 * These scan the production source tree (`apps/backend/src`) and fail the build
 * when a layering rule is violated, so the boundaries proven by hand in earlier
 * phases cannot silently erode. Source scanning is used deliberately: the rules
 * are about imports and literal SQL, which are reliably visible in text and do
 * not need a full type graph.
 */
const SRC = resolve(process.cwd(), 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const ALL_TS = walk(SRC);
const PRODUCTION_TS = ALL_TS.filter((f) => !f.endsWith('.spec.ts'));
const read = (f: string): string => readFileSync(f, 'utf8');
const rel = (f: string): string => f.slice(SRC.length + 1);

function filesMatching(suffix: string): string[] {
  return PRODUCTION_TS.filter((f) => f.endsWith(suffix));
}

describe('architecture boundaries', () => {
  const controllers = filesMatching('.controller.ts');
  const guards = filesMatching('.guard.ts');

  it('has a controller and guard surface to check', () => {
    expect(controllers.length).toBeGreaterThan(15);
    expect(guards.length).toBeGreaterThan(0);
  });

  it('controllers do not import DatabaseService, the pool, or postgres adapters', () => {
    const offenders = controllers.filter((f) => {
      const src = read(f);
      return (
        /infrastructure\/database/.test(src) ||
        /DatabaseService|TransactionManager|DATABASE_POOL/.test(src) ||
        /postgres-[\w-]+\.repository/.test(src)
      );
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it('controllers contain no raw SQL', () => {
    const sqlLike =
      /\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i;
    const offenders = controllers.filter((f) => {
      const src = read(f);
      return sqlLike.test(src) || /\.query\s*\(/.test(src);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it('guards do not import repositories or the database layer (no DB in guards)', () => {
    const offenders = guards.filter((f) => {
      const src = read(f);
      return (
        /infrastructure\/database/.test(src) ||
        /\.repository/.test(src) ||
        /\.query\s*\(/.test(src)
      );
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it('production code never imports an in-memory repository (tests only)', () => {
    const offenders = PRODUCTION_TS.filter((f) =>
      /in-memory-[\w-]+\.repository/.test(read(f)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('the tickets module does not depend on a concrete payment provider', () => {
    const ticketFiles = PRODUCTION_TS.filter((f) =>
      rel(f).startsWith('modules/tickets/'),
    );
    const offenders = ticketFiles.filter((f) => {
      const src = read(f);
      return /test-payment\.provider|payment-provider\.port|payments\/postgres/.test(
        src,
      );
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it('payment provider adapters are only referenced via the module or the port', () => {
    // Only the payments module wiring/service/tests may name the concrete adapter.
    const offenders = PRODUCTION_TS.filter((f) => {
      if (rel(f).startsWith('modules/payments/')) return false;
      return /TestPaymentProvider/.test(read(f));
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it('contains no Phase 18 deployment code in the source tree', () => {
    const offenders = PRODUCTION_TS.filter((f) =>
      /(^|\/)(deployment|deploy|dockerfile|k8s|kubernetes|helm)(\.|\/)/i.test(
        rel(f),
      ),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});
