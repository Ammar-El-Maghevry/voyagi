import { ALL_PERMISSIONS, Permission } from '../authorization/permission.enum';
import { MembershipRole } from './membership-role';
import { permissionsForRoles, ROLE_PERMISSIONS } from './role-permissions';

/** The read set admitted by the company-scoped RLS read policies. */
const READ_SET = [
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

describe('role-permissions (documented matrix)', () => {
  it('grants a super admin every catalog permission (unrestricted)', () => {
    expect([...ROLE_PERMISSIONS[MembershipRole.SuperAdmin]]).toEqual([
      ...ALL_PERMISSIONS,
    ]);
  });

  it('grants a company manager full company authority (whole catalog)', () => {
    expect([...ROLE_PERMISSIONS[MembershipRole.CompanyManager]]).toEqual([
      ...ALL_PERMISSIONS,
    ]);
  });

  it('grants a branch employee exactly the read set — no writes (fail closed)', () => {
    expect([...ROLE_PERMISSIONS[MembershipRole.BranchEmployee]]).toEqual(READ_SET);
  });

  it('grants an agent the read set plus booking creation and commission visibility', () => {
    expect([...ROLE_PERMISSIONS[MembershipRole.Agent]]).toEqual([
      ...READ_SET,
      Permission.BookingsCreate,
      Permission.CommissionsRead,
    ]);
  });

  it('grants a passenger no permissions', () => {
    expect(ROLE_PERMISSIONS[MembershipRole.Passenger]).toHaveLength(0);
  });

  it('never grants an undocumented write to an employee or agent', () => {
    const undocumentedWrites = [
      Permission.CompaniesUpdate,
      Permission.MembershipsRead,
      Permission.MembershipsManage,
      Permission.BranchesManage,
      Permission.PaymentsConfirm,
      Permission.PaymentsRefund,
      Permission.TicketsIssue,
      Permission.TicketsValidate,
      Permission.BookingsCancel,
      Permission.AuditRead,
    ];
    for (const permission of undocumentedWrites) {
      expect(ROLE_PERMISSIONS[MembershipRole.BranchEmployee]).not.toContain(permission);
    }
    // The agent's only write is bookings.create.
    for (const permission of undocumentedWrites) {
      expect(ROLE_PERMISSIONS[MembershipRole.Agent]).not.toContain(permission);
    }
    expect(ROLE_PERMISSIONS[MembershipRole.Agent]).not.toContain(
      Permission.BookingsCancel,
    );
  });

  describe('permissionsForRoles', () => {
    it('returns an empty set for no roles (fail closed)', () => {
      expect(permissionsForRoles([])).toEqual([]);
    });

    it('unions and de-duplicates without expanding beyond the component roles', () => {
      const combined = permissionsForRoles([
        MembershipRole.BranchEmployee,
        MembershipRole.Agent,
      ]);
      // No duplicates.
      expect(new Set(combined).size).toBe(combined.length);
       // Union = read set + the agent's documented additions, and nothing more.
       expect(new Set(combined)).toEqual(
        new Set([...READ_SET, Permission.BookingsCreate, Permission.CommissionsRead]),
      );
      // Every granted permission comes from at least one component role.
      const componentUnion = new Set([
        ...ROLE_PERMISSIONS[MembershipRole.BranchEmployee],
        ...ROLE_PERMISSIONS[MembershipRole.Agent],
      ]);
      expect(combined.every((p) => componentUnion.has(p))).toBe(true);
      // Catalog order preserved.
      const orderIndex = combined.map((p) => ALL_PERMISSIONS.indexOf(p));
      expect(orderIndex).toEqual([...orderIndex].sort((a, b) => a - b));
    });

    it('a manager membership alone yields the full catalog', () => {
      expect(permissionsForRoles([MembershipRole.CompanyManager])).toEqual([
        ...ALL_PERMISSIONS,
      ]);
    });
  });
});
