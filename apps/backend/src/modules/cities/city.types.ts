/**
 * A city (`public.cities`) — global reference data shared across all tenants,
 * not owned by any company. Only active cities are ever surfaced through the
 * API (the RLS `cities_read_active` policy admits any authenticated user to
 * read active rows). The table has no `deleted_at`/`updated_at` columns.
 */
export interface City {
  readonly id: string;
  readonly nameAr: string;
  readonly nameFr: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
}
