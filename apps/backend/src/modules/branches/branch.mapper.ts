import type { Branch } from './branch.types';

/** Raw `branches` row (bigint columns arrive as strings from `pg`). */
export interface BranchRow {
  id: string;
  company_id: string;
  city_id: string;
  name_ar: string;
  name_fr: string;
  phone: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Explicit, non-`SELECT *` column list (aligned with {@link BranchRow}). */
export const BRANCH_COLUMNS =
  'id, company_id, city_id, name_ar, name_fr, phone, is_active, created_at, updated_at';

export function toBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    companyId: row.company_id,
    cityId: row.city_id,
    nameAr: row.name_ar,
    nameFr: row.name_fr,
    phone: row.phone === null ? undefined : row.phone,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
