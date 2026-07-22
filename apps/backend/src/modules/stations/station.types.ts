/**
 * A station (`public.stations`) — reference data associated with a city, shared
 * across all tenants (there is no company or branch column). Only active,
 * non-deleted stations are surfaced through the API, matching the RLS
 * `stations_read_active` policy (`is_active and deleted_at is null`).
 */
export interface Station {
  readonly id: string;
  readonly cityId: string;
  readonly nameAr: string;
  readonly nameFr: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
