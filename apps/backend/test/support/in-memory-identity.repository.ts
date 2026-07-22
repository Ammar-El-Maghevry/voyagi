import type { ResolvedPagination } from '../../src/common/pagination/pagination';
import { DatabaseConnectionError } from '../../src/infrastructure/database/database.errors';
import type {
  IdentityRepository,
  PagedResult,
} from '../../src/modules/identity/identity.repository';
import type {
  Membership,
  MembershipView,
  Profile,
  ProfileUpdate,
} from '../../src/modules/identity/identity.types';
import { MembershipRole } from '../../src/modules/identity/membership-role';

interface SeedMembership {
  id: string;
  userId: string;
  companyId: string;
  role: MembershipRole;
  branchId?: string;
  isActive?: boolean;
}

/**
 * In-memory {@link IdentityRepository} for e2e tests: exercises the full HTTP
 * and authorization pipeline without a real database, while preserving the same
 * tenant-scoping semantics the SQL adapter guarantees (membership reads are
 * always filtered by company id).
 */
export class InMemoryIdentityRepository implements IdentityRepository {
  private readonly profiles = new Map<string, Profile>();
  private readonly companyNames = new Map<string, string>();
  private readonly memberships: Membership[] = [];
  /** User ids whose membership lookup should simulate a database outage. */
  private readonly failMembershipLookupFor = new Set<string>();

  /**
   * Make the membership lookup for `userId` reject as if the database were
   * unreachable, so a test can assert the failure surfaces as a dependency
   * error (503) and is never converted into a `403` denial.
   */
  failMembershipsFor(userId: string): void {
    this.failMembershipLookupFor.add(userId);
  }

  /** Clear any injected faults so later tests see a healthy repository. */
  clearFailures(): void {
    this.failMembershipLookupFor.clear();
  }

  addCompany(id: string, name: string): void {
    this.companyNames.set(id, name);
  }

  addProfile(id: string, fullName: string, isActive = true): void {
    const now = new Date('2026-01-01T00:00:00.000Z');
    this.profiles.set(id, {
      id,
      fullName,
      isActive,
      createdAt: now,
      updatedAt: now,
    });
  }

  addMembership(seed: SeedMembership): void {
    const now = new Date('2026-01-01T00:00:00.000Z');
    this.memberships.push({
      id: seed.id,
      userId: seed.userId,
      companyId: seed.companyId,
      branchId: seed.branchId,
      role: seed.role,
      isActive: seed.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });
  }

  findProfileByUserId(userId: string): Promise<Profile | null> {
    return Promise.resolve(this.profiles.get(userId) ?? null);
  }

  updateProfile(userId: string, update: ProfileUpdate): Promise<Profile | null> {
    const existing = this.profiles.get(userId);
    if (!existing) {
      return Promise.resolve(null);
    }
    const next: Profile = {
      ...existing,
      fullName: update.fullName ?? existing.fullName,
      phoneNumber:
        update.phoneNumber === undefined
          ? existing.phoneNumber
          : (update.phoneNumber ?? undefined),
      updatedAt: new Date(),
    };
    this.profiles.set(userId, next);
    return Promise.resolve(next);
  }

  findActiveMembershipsForCompany(
    userId: string,
    companyId: string,
  ): Promise<Membership[]> {
    if (this.failMembershipLookupFor.has(userId)) {
      return Promise.reject(new DatabaseConnectionError());
    }
    return Promise.resolve(
      this.memberships.filter(
        (m) => m.userId === userId && m.companyId === companyId && m.isActive,
      ),
    );
  }

  listMembershipsForUser(
    userId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<MembershipView>> {
    const all = this.memberships.filter((m) => m.userId === userId && m.isActive);
    return Promise.resolve(this.paginate(all, pagination));
  }

  listCompanyMemberships(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<MembershipView>> {
    const all = this.memberships.filter((m) => m.companyId === companyId);
    return Promise.resolve(this.paginate(all, pagination));
  }

  findCompanyMembership(
    companyId: string,
    membershipId: string,
  ): Promise<MembershipView | null> {
    const found = this.memberships.find(
      (m) => m.id === membershipId && m.companyId === companyId,
    );
    return Promise.resolve(found ? this.toView(found) : null);
  }

  private paginate(
    rows: Membership[],
    pagination: ResolvedPagination,
  ): PagedResult<MembershipView> {
    const page = rows.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );
    return { items: page.map((m) => this.toView(m)), total: rows.length };
  }

  private toView(membership: Membership): MembershipView {
    return {
      ...membership,
      companyName: this.companyNames.get(membership.companyId) ?? 'Unknown',
      memberName: this.profiles.get(membership.userId)?.fullName ?? 'Unknown',
    };
  }
}
