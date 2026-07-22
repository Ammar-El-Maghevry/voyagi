/**
 * A company branch (`public.branches`) as the branches domain uses it.
 *
 * Branches belong to exactly one company and reference a city. Soft-deleted
 * rows (`deleted_at is not null`) are never surfaced. Bilingual names mirror the
 * schema (`name_ar`, `name_fr`).
 */
export interface Branch {
  readonly id: string;
  readonly companyId: string;
  readonly cityId: string;
  readonly nameAr: string;
  readonly nameFr: string;
  readonly phone?: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Fields required to create a branch. `companyId` comes from the tenant context, never the body. */
export interface BranchCreate {
  readonly cityId: string;
  readonly nameAr: string;
  readonly nameFr: string;
  readonly phone?: string;
}

/**
 * Mutable descriptive fields of a branch. `isActive` is intentionally excluded:
 * activation is a dedicated state transition (activate/deactivate), never a
 * generic PATCH field. A `phone` of `null` clears the stored number.
 */
export interface BranchUpdate {
  readonly cityId?: string;
  readonly nameAr?: string;
  readonly nameFr?: string;
  readonly phone?: string | null;
}
