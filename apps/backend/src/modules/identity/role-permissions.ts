import { ALL_PERMISSIONS, Permission } from '../authorization/permission.enum';
import { MembershipRole } from './membership-role';

/**
 * Default role → permission catalog, with an explicit documentary citation for
 * every grant. The database has no `roles`/`permissions`/`role_permissions`
 * table (roles are the `public.user_role_enum` on `company_memberships`), so
 * this map is the application-side expansion the architecture calls the
 * "manageable default permission set" (`13-backend-architecture.md` §10.3).
 *
 * Grounding rules (deliberately strict — every grant is cited; anything not
 * cited is NOT granted, i.e. fail closed):
 *
 * - A **read** permission is granted only where a specific RLS *read* policy in
 *   `supabase/migrations/…_012_rls.sql` admits the role to that resource. A read
 *   policy is never used to justify an unrelated write/management permission.
 * - A **management/write** permission is granted only where a management-level
 *   authorization predicate (`private.can_manage_company()`) or an explicit
 *   business-rule flow documents the role performing that action.
 *
 * ── Read set (RLS read policies keyed on `private.has_company_access()` /
 *    `private.has_branch_access()` / `private.can_access_booking()`), granted to
 *    COMPANY_MANAGER, BRANCH_EMPLOYEE and AGENT:
 *      companies.read    ← policy `companies_tenant_read`     (has_company_access)
 *      branches.read     ← policy `branches_tenant_read`      (has_branch_access)
 *      staff.read        ← policy `staff_tenant_read`         (has_company_access)
 *      fleet.read        ← policy `buses_tenant_read`         (has_company_access)
 *      routes.read       ← policy `routes_tenant_read`        (has_company_access)
 *      trips.read        ← policy `trips_tenant_read`         (has_company_access)
 *      bookings.read     ← policy `bookings_authorized_read`  (has_branch_access)
 *      payments.read     ← policy `payments_authorized_read`  (can_access_booking)
 *      tickets.read      ← policy `tickets_authorized_read`   (can_access_booking)
 *      maintenance.read  ← policy `maintenance_tenant_read`   (has_company_access)
 *
 * ── Manager-only reads (RLS read policies keyed on `can_manage_company()`):
 *      memberships.read  ← policy `memberships_tenant_read`   (can_manage_company)
 *      audit.read        ← policy `audit_manager_read`        (can_manage_company)
 *
 * ── COMPANY_MANAGER management/operational permissions: `can_manage_company()`
 *    is the documented "manages this company" predicate; combined with
 *    `13-backend-architecture.md` §7.2 ("Companies owns tenant configuration",
 *    "Memberships owns company access and role assignment") and the
 *    `12-business-rules.md` manager flows (§3 manager creates/updates trips &
 *    maintenance, §6 manager updates company settings, §7 manager route prices),
 *    the manager holds full authority within the company — the whole catalog.
 *
 * ── AGENT: `bookings.create` — `12-business-rules.md` §1 and
 *    `06-agent-booking-sequence.md` document the agent membership as the booking
 *    creator (`booked_by_user_id` is the agent). `commissions.read` is limited by
 *    the commissions service to the agent's own active membership rows. No other
 *    agent write is documented, so none is granted.
 *
 * ── SUPER_ADMIN: unrestricted. `private.is_super_admin()` short-circuits every
 *    authorization predicate in `012_rls.sql` (`has_company_access`,
 *    `can_manage_company`, `has_branch_access` are all `is_super_admin() OR …`),
 *    so it satisfies every gate — the whole catalog. (Same set as a manager, but
 *    for a different, platform-wide reason.)
 *
 * ── BRANCH_EMPLOYEE and PASSENGER: no write is documented. The employee gets
 *    the read set only; the passenger gets nothing (it reaches its own resources
 *    through ownership, never a company-scoped permission). Branch-office
 *    ticketing/payment writes are deliberately deferred to the phase that
 *    defines those flows rather than granted here without a citation.
 *
 * This is a flat mapping, not a role hierarchy: no role inherits another's
 * grants implicitly.
 */

/** Reads admitted by the company-scoped RLS read policies (see block above). */
const COMPANY_READ_PERMISSIONS: readonly Permission[] = [
  Permission.CompaniesRead,
  Permission.BranchesRead,
  Permission.StaffRead,
  Permission.FleetRead,
  Permission.RoutesRead,
  Permission.TripsRead,
  Permission.BookingsRead,
  Permission.PaymentsRead,
  Permission.TicketsRead,
  Permission.MaintenanceRead,
];

export const ROLE_PERMISSIONS: Readonly<
  Record<MembershipRole, readonly Permission[]>
> = Object.freeze({
  // Unrestricted: satisfies every RLS predicate.
  [MembershipRole.SuperAdmin]: ALL_PERMISSIONS,

  // Full authority within the company (can_manage_company).
  [MembershipRole.CompanyManager]: ALL_PERMISSIONS,

  // Read set only.
  [MembershipRole.BranchEmployee]: Object.freeze([...COMPANY_READ_PERMISSIONS]),

  // Read set + documented booking creation.
  [MembershipRole.Agent]: Object.freeze([
    ...COMPANY_READ_PERMISSIONS,
    Permission.BookingsCreate,
    Permission.CommissionsRead,
  ]),

  // No company-scoped permission.
  [MembershipRole.Passenger]: Object.freeze([]),
});

/**
 * Effective permissions for a set of roles: the de-duplicated union of each
 * role's grants. Order follows the {@link Permission} catalog for determinism.
 * An empty role set yields no permissions (fail closed).
 */
export function permissionsForRoles(
  roles: readonly MembershipRole[],
): Permission[] {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role]) {
      granted.add(permission);
    }
  }
  return ALL_PERMISSIONS.filter((permission) => granted.has(permission));
}
