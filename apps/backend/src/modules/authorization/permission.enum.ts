/**
 * Central catalog of authorization permissions (`resource.action`).
 *
 * This enum is the single source of truth for permission strings across the
 * backend — permissions must never be written as inline string literals. Values
 * are part of the authorization contract and must remain stable once assigned;
 * they mirror the catalog defined in `18-backend-implementation-guide.md`
 * (Phase 4). Adding a permission here does not grant it to anyone: role and
 * membership assignment is resolved server-side from the database in a later
 * phase.
 */
export enum Permission {
  CompaniesRead = 'companies.read',
  CompaniesUpdate = 'companies.update',
  MembershipsRead = 'memberships.read',
  MembershipsManage = 'memberships.manage',
  BranchesRead = 'branches.read',
  BranchesManage = 'branches.manage',
  StaffRead = 'staff.read',
  StaffManage = 'staff.manage',
  FleetRead = 'fleet.read',
  FleetManage = 'fleet.manage',
  RoutesRead = 'routes.read',
  RoutesManage = 'routes.manage',
  TripsRead = 'trips.read',
  TripsManage = 'trips.manage',
  BookingsRead = 'bookings.read',
  BookingsCreate = 'bookings.create',
  BookingsCancel = 'bookings.cancel',
  PaymentsRead = 'payments.read',
  PaymentsConfirm = 'payments.confirm',
  PaymentsRefund = 'payments.refund',
  TicketsRead = 'tickets.read',
  TicketsIssue = 'tickets.issue',
  TicketsValidate = 'tickets.validate',
  MaintenanceRead = 'maintenance.read',
  MaintenanceManage = 'maintenance.manage',
  AuditRead = 'audit.read',
}

/** Every permission value, useful for validation and exhaustive iteration. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(
  Object.values(Permission),
);
