/**
 * Typed manifest of the fourteen critical end-to-end journeys.
 *
 * Each journey maps its required steps to CONCRETE executable tests: at least one
 * HTTP e2e proof, plus (where the journey has an authoritative PostgreSQL step)
 * a real integration/concurrency proof, plus (where a database constraint or
 * trigger is load-bearing) the migration that enforces it. The companion checker
 * (`journey-manifest.integration-spec.ts`) fails if a journey loses its e2e or
 * required integration proof, if an entry is removed, or if any referenced test
 * file or named test no longer exists.
 *
 * This does NOT re-implement the journeys — it is a coverage map over the real
 * suites, so it stays cheap while remaining machine-checkable.
 */

/** A reference to a concrete test: a file and a title substring that must exist. */
export interface TestRef {
  readonly file: string;
  readonly title: string;
}

export interface Journey {
  readonly id: number;
  readonly name: string;
  readonly steps: readonly string[];
  /** HTTP end-to-end proofs (at least one required for every journey). */
  readonly e2e: readonly TestRef[];
  /** Authoritative PostgreSQL / concurrency proofs. */
  readonly integration: readonly TestRef[];
  /** Migration files (substring) enforcing a load-bearing constraint/trigger. */
  readonly migrations: readonly string[];
  /** True when the journey has an authoritative DB step needing integration proof. */
  readonly requiresIntegration: boolean;
}

const AUTH_E2E = 'test/auth.e2e-spec.ts';
const AUTHZ_E2E = 'test/authorization.e2e-spec.ts';
const IDENTITY_E2E = 'test/identity.e2e-spec.ts';
const BRANCHES_E2E = 'test/branches.e2e-spec.ts';
const CATALOG_E2E = 'test/catalog.e2e-spec.ts';
const BUSES_E2E = 'test/buses.e2e-spec.ts';
const ROUTES_E2E = 'test/routes.e2e-spec.ts';
const TRIPS_E2E = 'test/trips.e2e-spec.ts';
const AVAIL_E2E = 'test/availability.e2e-spec.ts';
const BOOKINGS_E2E = 'test/bookings.e2e-spec.ts';
const PAYTIX_E2E = 'test/payments-tickets.e2e-spec.ts';

const BOOKINGS_INT = 'test/integration/bookings.integration-spec.ts';
const PAYTIX_INT = 'test/integration/payments-tickets.integration-spec.ts';
const AUDITCOMM_INT = 'test/integration/audit-commissions.integration-spec.ts';

export const JOURNEYS: readonly Journey[] = [
  {
    id: 1,
    name: 'Authentication',
    steps: ['valid token', 'authenticated principal', 'profile'],
    e2e: [{ file: AUTH_E2E, title: 'Authentication (e2e)' }],
    integration: [
      {
        file: 'test/integration/jwks-verification.integration-spec.ts',
        title: 'Remote JWKS verification (integration)',
      },
    ],
    migrations: [],
    requiresIntegration: false,
  },
  {
    id: 2,
    name: 'Tenant selection',
    steps: ['active membership', 'authorized company context'],
    e2e: [{ file: AUTHZ_E2E, title: 'Authorization (e2e)' }],
    integration: [
      {
        file: 'test/integration/identity.integration-spec.ts',
        title: 'Identity domain (integration)',
      },
    ],
    migrations: [],
    requiresIntegration: false,
  },
  {
    id: 3,
    name: 'Company management',
    steps: [
      'manager operation',
      'membership/company mutation',
      'audit evidence',
    ],
    e2e: [
      { file: IDENTITY_E2E, title: 'Identity (e2e)' },
      { file: BRANCHES_E2E, title: 'Branches (e2e)' },
    ],
    integration: [
      {
        file: AUDITCOMM_INT,
        title:
          'stores valid audit context, nulls invalid context, and redacts metadata before persistence',
      },
    ],
    migrations: [],
    requiresIntegration: true,
  },
  {
    id: 4,
    name: 'Fleet and route setup',
    steps: ['station', 'seat layout', 'bus', 'route', 'route price'],
    e2e: [
      {
        file: CATALOG_E2E,
        title: 'Catalog: cities, stations, seat-layouts (e2e)',
      },
      { file: BUSES_E2E, title: 'Buses / fleet (e2e)' },
      { file: ROUTES_E2E, title: 'Routes & pricing (e2e)' },
    ],
    integration: [
      {
        file: 'test/integration/buses.integration-spec.ts',
        title: 'Buses domain (integration)',
      },
      {
        file: 'test/integration/routes.integration-spec.ts',
        title: 'Routes & pricing domain (integration)',
      },
    ],
    migrations: [],
    requiresIntegration: false,
  },
  {
    id: 5,
    name: 'Trip creation',
    steps: ['route/price/bus', 'schedule validation', 'trip query'],
    e2e: [{ file: TRIPS_E2E, title: 'Trips (e2e)' }],
    integration: [
      {
        file: 'test/integration/trips.integration-spec.ts',
        title: 'Trips domain (integration)',
      },
    ],
    migrations: ['014_trip_schedule_exclusion'],
    requiresIntegration: true,
  },
  {
    id: 6,
    name: 'Passenger booking',
    steps: [
      'public availability',
      'booking',
      'passenger snapshots',
      'seat hold',
      'event',
    ],
    e2e: [
      { file: AVAIL_E2E, title: 'Public availability HTTP API (e2e)' },
      { file: BOOKINGS_E2E, title: 'Bookings (e2e)' },
    ],
    integration: [
      { file: BOOKINGS_INT, title: 'Booking engine (PostgreSQL integration)' },
    ],
    migrations: ['015_booking_engine'],
    requiresIntegration: true,
  },
  {
    id: 7,
    name: 'Agent booking',
    steps: [
      'agent membership',
      'branch authorization',
      'booking hold',
      'price snapshot',
    ],
    e2e: [{ file: BOOKINGS_E2E, title: 'Bookings (e2e)' }],
    integration: [
      { file: BOOKINGS_INT, title: 'Booking engine (PostgreSQL integration)' },
    ],
    migrations: ['015_booking_engine'],
    requiresIntegration: true,
  },
  {
    id: 8,
    name: 'Seat conflict',
    steps: ['concurrent same-seat requests', 'exactly one success'],
    e2e: [{ file: BOOKINGS_E2E, title: 'Bookings (e2e)' }],
    integration: [
      {
        file: BOOKINGS_INT,
        title: 'allows exactly one simultaneous booking for the same seat',
      },
    ],
    migrations: ['015_booking_engine'],
    requiresIntegration: true,
  },
  {
    id: 9,
    name: 'Payment confirmation',
    steps: [
      'payment initiation',
      'confirmation/webhook',
      'booking and seats confirmed',
    ],
    e2e: [{ file: PAYTIX_E2E, title: 'Payments & Tickets (e2e)' }],
    integration: [
      {
        file: PAYTIX_INT,
        title:
          'confirms an online payment via a signed webhook, idempotent under duplicate delivery',
      },
    ],
    migrations: ['016_payments_tickets_engine'],
    requiresIntegration: true,
  },
  {
    id: 10,
    name: 'Ticket issuance',
    steps: [
      'paid booking',
      'tickets once',
      'one per passenger/seat',
      'QR hash only',
    ],
    e2e: [{ file: PAYTIX_E2E, title: 'Payments & Tickets (e2e)' }],
    integration: [
      {
        file: PAYTIX_INT,
        title:
          'issues one ticket per passenger/seat, idempotently and only once',
      },
      {
        file: PAYTIX_INT,
        title: 'persists only the QR hash, never the raw token',
      },
    ],
    migrations: ['016_payments_tickets_engine'],
    requiresIntegration: true,
  },
  {
    id: 11,
    name: 'Ticket validation',
    steps: ['raw token verification', 'validation', 'transactional audit'],
    e2e: [{ file: PAYTIX_E2E, title: 'Payments & Tickets (e2e)' }],
    integration: [
      {
        file: PAYTIX_INT,
        title:
          'validates (checks in) a ticket once; a duplicate scan is rejected',
      },
    ],
    migrations: ['016_payments_tickets_engine'],
    requiresIntegration: true,
  },
  {
    id: 12,
    name: 'Booking cancellation',
    steps: [
      'eligible held booking',
      'cancellation',
      'seat release',
      'event',
      'audit',
    ],
    e2e: [{ file: BOOKINGS_E2E, title: 'Bookings (e2e)' }],
    integration: [
      {
        file: BOOKINGS_INT,
        title: 'releases a cancelled seat so it can be booked again',
      },
    ],
    migrations: ['015_booking_engine'],
    requiresIntegration: true,
  },
  {
    id: 13,
    name: 'Full refund',
    steps: [
      'successful payment',
      'REFUNDED',
      'ticket revocation',
      'commission handling',
      'audit',
    ],
    e2e: [{ file: PAYTIX_E2E, title: 'Payments & Tickets (e2e)' }],
    integration: [
      {
        file: PAYTIX_INT,
        title:
          'refunds a settled payment exactly once under concurrent refunds',
      },
      {
        file: PAYTIX_INT,
        title:
          'verifies a valid token and reports refunded bookings as invalid',
      },
      {
        file: AUDITCOMM_INT,
        title:
          'rejects direct changes to an earned commission financial snapshot',
      },
    ],
    migrations: [
      '016_payments_tickets_engine',
      '017_maintenance_commissions_engine',
    ],
    requiresIntegration: true,
  },
  {
    id: 14,
    name: 'Cross-tenant denial',
    steps: ['identifier swapping across critical resources', 'no leakage'],
    e2e: [{ file: AUTHZ_E2E, title: 'Authorization (e2e)' }],
    integration: [
      {
        file: PAYTIX_INT,
        title: 'rejects paying another user’s booking with a safe 404',
      },
      {
        file: 'test/integration/rls-matrix.integration-spec.ts',
        title: 'Consolidated RLS matrix (integration)',
      },
    ],
    migrations: ['012_rls'],
    requiresIntegration: true,
  },
];
