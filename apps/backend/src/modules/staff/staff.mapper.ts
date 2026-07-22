import { parseStaffType } from './staff-type';
import type { StaffMember } from './staff.types';

/** Raw `staff_members` row (bigint columns arrive as strings from `pg`). */
export interface StaffMemberRow {
  id: string;
  company_id: string;
  full_name: string;
  phone: string | null;
  staff_type: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Explicit, non-`SELECT *` column list (aligned with {@link StaffMemberRow}). */
export const STAFF_COLUMNS =
  'id, company_id, full_name, phone, staff_type, is_active, created_at, updated_at';

/**
 * Map a staff row to the domain type, or `null` when its `staff_type` is not a
 * value this application version knows (fail closed — the caller excludes it).
 */
export function toStaffMember(row: StaffMemberRow): StaffMember | null {
  const staffType = parseStaffType(row.staff_type);
  if (staffType === null) {
    return null;
  }
  return {
    id: row.id,
    companyId: row.company_id,
    fullName: row.full_name,
    phone: row.phone === null ? undefined : row.phone,
    staffType,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
