import type { ResolvedPagination } from '../../common/pagination/pagination';
import type {
  Membership,
  MembershipView,
  Profile,
  ProfileUpdate,
} from './identity.types';

/** A single page of rows plus the unbounded total, for building pagination meta. */
export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** DI token bound to the concrete {@link IdentityRepository} implementation. */
export const IDENTITY_REPOSITORY = Symbol('IDENTITY_REPOSITORY');

/**
 * Persistence port for the identity domain (profiles and company memberships).
 *
 * Every method is tenant-scoped where applicable: membership reads are always
 * filtered by `company_id`, so the backend's trusted (RLS-bypassing) connection
 * cannot accidentally cross company boundaries. Implementations return typed
 * domain objects, never raw database rows, and translate driver failures into
 * the shared database exceptions.
 */
export interface IdentityRepository {
  /** The profile for an auth user id, or `null` if none exists. */
  findProfileByUserId(userId: string): Promise<Profile | null>;

  /**
   * Update the caller's own updatable profile fields, returning the new state,
   * or `null` when no profile row exists for the user.
   */
  updateProfile(
    userId: string,
    update: ProfileUpdate,
  ): Promise<Profile | null>;

  /** Active memberships the user holds in one specific company (may be empty). */
  findActiveMembershipsForCompany(
    userId: string,
    companyId: string,
  ): Promise<Membership[]>;

  /** A page of the user's active memberships across all companies. */
  listMembershipsForUser(
    userId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<MembershipView>>;

  /** A page of every membership within one company (tenant-scoped). */
  listCompanyMemberships(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<MembershipView>>;

  /** A single membership addressed within one company, or `null` if not there. */
  findCompanyMembership(
    companyId: string,
    membershipId: string,
  ): Promise<MembershipView | null>;
}
