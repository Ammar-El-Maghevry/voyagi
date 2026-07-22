import type { Permission } from '../authorization/permission.enum';
import type { BranchAccess } from './branch-access';
import type { Entitlement } from './entitlements';
import type { MembershipRole } from './membership-role';

/**
 * Backend profile of an authenticated user (`public.profiles`). `id` equals the
 * Supabase auth user id. Contains only non-sensitive identity fields.
 */
export interface Profile {
  /** Profile id — identical to the auth user id (`profiles.id`). */
  readonly id: string;
  readonly fullName: string;
  readonly phoneNumber?: string;
  /** Whether the account is enabled; a disabled profile is denied authorization. */
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A user's membership of a company (`public.company_memberships`) as the
 * identity domain uses it. `commission_rate` and other operational columns are
 * intentionally excluded — they belong to later domains.
 */
export interface Membership {
  readonly id: string;
  readonly userId: string;
  readonly companyId: string;
  /** Set only for branch-scoped roles (employee/agent); otherwise undefined. */
  readonly branchId?: string;
  readonly role: MembershipRole;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A membership joined with its company, plus the member's display name — the
 * shape backing "the companies I belong to" and company membership listings.
 */
export interface MembershipView extends Membership {
  readonly companyName: string;
  readonly memberName: string;
}

/**
 * The fully resolved authorization state of a caller within one company: their
 * profile, all active memberships, effective (de-duplicated) permissions, and
 * resolved branch access. Assembled by
 * {@link IdentityService.resolveMembershipContext} from database state only.
 *
 * There is intentionally no "primary membership": the documentation defines no
 * rule for choosing one among several active memberships, so none is invented.
 * The authoritative grant is always the *union* of every membership's
 * permissions ({@link permissions}); a single membership id/role is surfaced to
 * the authorization context only when it is unambiguous (exactly one active
 * membership) — see {@link Membership} and the resolver.
 *
 * {@link permissions} and {@link branchAccess} are each a caller-wide union and
 * are safe for *company-scoped* decisions. They must **never** be intersected to
 * make a *branch-scoped* decision — that forms a cross-product across
 * memberships (a permission from one membership + a branch from another). For
 * branch-scoped authority use {@link entitlements}, which keeps each
 * membership's permissions coupled to that same membership's branch scope
 * (`effectivePermissionsForBranch` / `canExercisePermissionInBranch`).
 */
export interface MembershipContext {
  readonly profile: Profile;
  readonly companyId: string;
  readonly memberships: readonly Membership[];
  /** Caller-wide union — for company-scoped checks only (see doc-comment). */
  readonly permissions: readonly Permission[];
  /** Caller-wide union of reachable branches — never intersect with {@link permissions}. */
  readonly branchAccess: BranchAccess;
  /** Per-membership grants, permission coupled to branch scope, for branch-scoped checks. */
  readonly entitlements: readonly Entitlement[];
}

/** Fields a user may update on their own profile (RLS grants exactly these). */
export interface ProfileUpdate {
  readonly fullName?: string;
  readonly phoneNumber?: string | null;
}
