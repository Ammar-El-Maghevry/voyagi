import type {
  Membership,
  MembershipView,
  Profile,
} from './identity.types';
import { parseMembershipRole } from './membership-role';

/** Raw `profiles` row (bigint/uuid columns arrive as strings from `pg`). */
export interface ProfileRow {
  id: string;
  full_name: string;
  phone_number: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Raw `company_memberships` row. */
export interface MembershipRow {
  id: string;
  user_id: string;
  company_id: string;
  branch_id: string | null;
  role: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Membership row joined with company name and the member's display name. */
export interface MembershipViewRow extends MembershipRow {
  company_name: string;
  member_name: string;
}

function optional(value: string | null): string | undefined {
  return value === null ? undefined : value;
}

export function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    fullName: row.full_name,
    phoneNumber: optional(row.phone_number),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Map a membership row to the domain type, or `null` when its role is not a
 * value this application version knows (fail closed — the caller must exclude
 * it, never grant a default).
 */
export function toMembership(row: MembershipRow): Membership | null {
  const role = parseMembershipRole(row.role);
  if (role === null) {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    branchId: optional(row.branch_id),
    role,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Map a joined membership-view row, or `null` for an unknown role. */
export function toMembershipView(row: MembershipViewRow): MembershipView | null {
  const membership = toMembership(row);
  if (membership === null) {
    return null;
  }
  return {
    ...membership,
    companyName: row.company_name,
    memberName: row.member_name,
  };
}
