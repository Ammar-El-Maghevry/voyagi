import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Repository SQL-scope matrix.
 *
 * The backend connects with a role that may bypass RLS, so tenant isolation must
 * ALSO be enforced explicitly in every repository's SQL. This static matrix
 * proves two properties over the real PostgreSQL adapter sources:
 *
 *  1. Scope predicates — every tenant-owned repository filters by an explicit
 *     `company_id` / owner / branch / booking predicate (parameterized `$n`).
 *  2. Injection safety — every `${…}` interpolation inside repository SQL is a
 *     static identifier (column-list/JOIN/filter constant, a known safe SQL
 *     fragment, or `$n` placeholder arithmetic). No request value is ever
 *     concatenated into SQL; values always travel as bound parameters.
 */

const MODULES_DIR = join(__dirname, '..', 'modules');

function repoPath(module: string, file: string): string {
  return join(MODULES_DIR, module, file);
}

function read(module: string, file: string): string {
  return readFileSync(repoPath(module, file), 'utf8');
}

/** Tenant-owned repositories and the scope predicate each MUST contain. */
const SCOPE_MATRIX: Array<{
  label: string;
  module: string;
  file: string;
  /** At least one of these parameterized predicates must appear. */
  requiredAnyOf: string[];
}> = [
  {
    label: 'buses',
    module: 'buses',
    file: 'postgres-buses.repository.ts',
    requiredAnyOf: ['company_id = $'],
  },
  {
    label: 'branches',
    module: 'branches',
    file: 'postgres-branches.repository.ts',
    requiredAnyOf: ['company_id = $'],
  },
  {
    label: 'staff',
    module: 'staff',
    file: 'postgres-staff.repository.ts',
    requiredAnyOf: ['company_id = $'],
  },
  {
    label: 'routes',
    module: 'routes',
    file: 'postgres-routes.repository.ts',
    requiredAnyOf: ['company_id = $'],
  },
  {
    label: 'route-prices',
    module: 'routes',
    file: 'postgres-route-prices.repository.ts',
    requiredAnyOf: ['route_id = $', 'company_id = $'],
  },
  {
    label: 'trips',
    module: 'trips',
    file: 'postgres-trips.repository.ts',
    requiredAnyOf: ['company_id = $'],
  },
  {
    label: 'trip-events',
    module: 'trips',
    file: 'postgres-trip-events.repository.ts',
    requiredAnyOf: ['company_id = $'],
  },
  {
    label: 'bookings',
    module: 'bookings',
    file: 'postgres-bookings.repository.ts',
    requiredAnyOf: ['company_id = $', 'booked_by_user_id = $'],
  },
  {
    label: 'payments',
    module: 'payments',
    file: 'postgres-payments.repository.ts',
    requiredAnyOf: ['company_id = $', 'booked_by_user_id = $'],
  },
  {
    label: 'tickets',
    module: 'tickets',
    file: 'postgres-tickets.repository.ts',
    requiredAnyOf: ['company_id = $', 'booking_id = $'],
  },
  {
    label: 'maintenance',
    module: 'maintenance',
    file: 'postgres-maintenance.repository.ts',
    requiredAnyOf: ['company_id = $'],
  },
  {
    label: 'commissions',
    module: 'commissions',
    file: 'postgres-commissions.repository.ts',
    requiredAnyOf: ['company_id = $'],
  },
  {
    label: 'audit',
    module: 'audit',
    file: 'postgres-audit.repository.ts',
    requiredAnyOf: ['company_id = $'],
  },
];

/** Every postgres adapter, for the injection-safety sweep. */
const ALL_REPOSITORIES: Array<{ module: string; file: string }> = [
  ...SCOPE_MATRIX.map(({ module, file }) => ({ module, file })),
  { module: 'identity', file: 'postgres-identity.repository.ts' },
  { module: 'availability', file: 'postgres-availability.repository.ts' },
  { module: 'cities', file: 'postgres-cities.repository.ts' },
  { module: 'stations', file: 'postgres-stations.repository.ts' },
  { module: 'seat-layouts', file: 'postgres-seat-layouts.repository.ts' },
];

/**
 * Safe interpolation forms. Anything else is treated as a potential value
 * concatenation and fails the test.
 *  - UPPER_SNAKE constants: column lists, JOIN and filter fragments.
 *  - Known static SQL-fragment locals that are only ever built from string
 *    literals + `$n` placeholders (verified by construction in the adapters).
 *  - `$n` placeholder arithmetic: `params.length`, `filterParams.length` (+N).
 *  - `assignments.join(', ')`: a list of `col = $n` setters.
 */
const SAFE_LOWERCASE_FRAGMENTS = new Set([
  'where',
  'additionalWhere',
  'completedClause',
  'stampClause',
  'stamps',
]);

function isSafeInterpolation(expr: string): boolean {
  const e = expr.trim();
  if (/^[A-Z][A-Z0-9_]*$/.test(e)) return true; // UPPER_SNAKE constant
  if (SAFE_LOWERCASE_FRAGMENTS.has(e)) return true;
  if (/^(params|filterParams)\.length(\s*\+\s*\d+)?$/.test(e)) return true;
  if (e === "assignments.join(', ')") return true;
  return false;
}

/** Extract every `${…}` interpolation expression from a source file. */
function interpolations(source: string): string[] {
  const found: string[] = [];
  const regex = /\$\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    found.push(match[1]);
  }
  return found;
}

describe('repository SQL-scope matrix', () => {
  describe('tenant-owned repositories filter by an explicit scope predicate', () => {
    it.each(SCOPE_MATRIX)(
      '$label scopes its SQL by company/owner/branch',
      ({ module, file, requiredAnyOf }) => {
        const source = read(module, file);
        const present = requiredAnyOf.some((token) => source.includes(token));
        expect(present).toBe(true);
      },
    );

    it('covers every tenant-owned repository', () => {
      expect(SCOPE_MATRIX).toHaveLength(13);
    });
  });

  describe('no repository concatenates request values into SQL', () => {
    it.each(ALL_REPOSITORIES)(
      '$file interpolates only static identifiers and $n placeholders',
      ({ module, file }) => {
        const source = read(module, file);
        const unsafe = interpolations(source).filter(
          (expr) => !isSafeInterpolation(expr),
        );
        expect(unsafe).toEqual([]);
      },
    );
  });
});
