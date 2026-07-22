import { Inject, Injectable } from '@nestjs/common';
import { ValidationException } from '../../common/validation/validation.exception';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { resolveBranchAccess } from './branch-access';
import { resolveEntitlements } from './entitlements';
import { isUuid, parsePositiveBigInt } from './identifier.util';
import {
  MembershipNotFoundError,
  ProfileNotFoundError,
} from './identity.errors';
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
  type PagedResult,
} from './identity.repository';
import type {
  MembershipContext,
  MembershipView,
  Profile,
  ProfileUpdate,
} from './identity.types';
import { permissionsForRoles } from './role-permissions';

/**
 * Application service for the identity domain.
 *
 * Owns profile lookup/update and the resolution of a caller's company
 * membership context (profile → active memberships → effective permissions →
 * branch access) from database state only. It never trusts client-supplied
 * identity data: the auth user id always comes from the verified principal, and
 * company/membership ids are validated before they reach a query.
 *
 * Genuine database failures propagate as the shared database exceptions and are
 * never converted into an authorization denial — resolution returns `null` only
 * for legitimate "no authorized context" outcomes.
 */
@Injectable()
export class IdentityService {
  constructor(
    @Inject(IDENTITY_REPOSITORY)
    private readonly repository: IdentityRepository,
  ) {}

  /** The caller's profile, or {@link ProfileNotFoundError} if none exists. */
  async getProfile(userId: string): Promise<Profile> {
    const profile = await this.findProfile(userId);
    if (!profile) {
      throw new ProfileNotFoundError();
    }
    return profile;
  }

  /**
   * Update the caller's own profile. Requires at least one updatable field and
   * fails with {@link ProfileNotFoundError} when the profile does not exist.
   */
  async updateProfile(userId: string, update: ProfileUpdate): Promise<Profile> {
    if (update.fullName === undefined && update.phoneNumber === undefined) {
      throw new ValidationException({
        body: ['At least one of fullName or phoneNumber must be provided.'],
      });
    }
    if (!isUuid(userId)) {
      // A verified principal always carries a UUID subject; guard defensively so
      // a malformed id can never reach the query as an invalid-uuid 500.
      throw new ProfileNotFoundError();
    }
    const profile = await this.repository.updateProfile(userId, update);
    if (!profile) {
      throw new ProfileNotFoundError();
    }
    return profile;
  }

  /** The caller's profile if it exists and is active, else `null` (fail closed). */
  async findActiveProfile(userId: string): Promise<Profile | null> {
    const profile = await this.findProfile(userId);
    if (!profile || !profile.isActive) {
      return null;
    }
    return profile;
  }

  /**
   * Resolve the caller's authorization context within one company from the
   * database: active profile, active memberships, the de-duplicated effective
   * permission union, per-membership entitlements (permission coupled to branch
   * scope) and branch access. Returns `null` when no active, authorized context
   * exists (no/inactive profile, or no active membership in the company).
   */
  async resolveMembershipContext(
    userId: string,
    companyId: string,
  ): Promise<MembershipContext | null> {
    const profile = await this.findActiveProfile(userId);
    if (!profile) {
      return null;
    }

    const normalizedCompanyId = parsePositiveBigInt(companyId);
    if (normalizedCompanyId === null) {
      return null;
    }

    const memberships = await this.repository.findActiveMembershipsForCompany(
      profile.id,
      normalizedCompanyId,
    );
    if (memberships.length === 0) {
      return null;
    }

    return {
      profile,
      companyId: normalizedCompanyId,
      memberships,
      // Caller-wide unions: safe for company-scoped checks only.
      permissions: permissionsForRoles(memberships.map((m) => m.role)),
      branchAccess: resolveBranchAccess(memberships),
      // Per-membership grants keep each permission coupled to the branch scope of
      // the membership that granted it, so branch-scoped decisions never form a
      // cross-product across memberships.
      entitlements: resolveEntitlements(memberships),
    };
  }

  /** A page of the companies the caller belongs to (active memberships). */
  async listMyCompanies(
    userId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<MembershipView>> {
    if (!isUuid(userId)) {
      return { items: [], total: 0 };
    }
    return this.repository.listMembershipsForUser(userId, pagination);
  }

  /** A page of every membership in a company. The caller's access is enforced upstream. */
  async listCompanyMemberships(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<MembershipView>> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    if (normalizedCompanyId === null) {
      return { items: [], total: 0 };
    }
    return this.repository.listCompanyMemberships(
      normalizedCompanyId,
      pagination,
    );
  }

  /**
   * A single membership within a company. Fails with a scoped "not found" when
   * the id is malformed or belongs to another company, never revealing whether
   * it exists elsewhere.
   */
  async getCompanyMembership(
    companyId: string,
    membershipId: string,
  ): Promise<MembershipView> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    const normalizedMembershipId = parsePositiveBigInt(membershipId);
    if (normalizedCompanyId === null || normalizedMembershipId === null) {
      throw new MembershipNotFoundError();
    }
    const membership = await this.repository.findCompanyMembership(
      normalizedCompanyId,
      normalizedMembershipId,
    );
    if (!membership) {
      throw new MembershipNotFoundError();
    }
    return membership;
  }

  private async findProfile(userId: string): Promise<Profile | null> {
    if (!isUuid(userId)) {
      return null;
    }
    return this.repository.findProfileByUserId(userId);
  }
}
