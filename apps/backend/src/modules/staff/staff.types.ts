import type { StaffType } from './staff-type';

/**
 * A company staff member (`public.staff_members`) — an operational person
 * (driver/assistant), not an application user. Company-scoped (there is no
 * branch column). Soft-deleted rows are never surfaced.
 */
export interface StaffMember {
  readonly id: string;
  readonly companyId: string;
  readonly fullName: string;
  readonly phone?: string;
  readonly staffType: StaffType;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Fields required to create a staff member. `companyId` comes from the tenant context. */
export interface StaffMemberCreate {
  readonly fullName: string;
  readonly staffType: StaffType;
  readonly phone?: string;
}

/**
 * Mutable fields of a staff member. `isActive` is excluded: activation is a
 * dedicated transition, never a generic PATCH field. A `phone` of `null` clears
 * the stored number.
 */
export interface StaffMemberUpdate {
  readonly fullName?: string;
  readonly staffType?: StaffType;
  readonly phone?: string | null;
}
