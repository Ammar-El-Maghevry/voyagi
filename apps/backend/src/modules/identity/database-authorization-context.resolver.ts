import { Injectable, Logger } from '@nestjs/common';
import type { AuthorizationContext } from '../authorization/authorization-context';
import type {
  AuthorizationContextResolver,
  AuthorizationResolutionRequest,
} from '../authorization/authorization-context-resolver';
import { IdentityService } from './identity.service';

/**
 * Database-backed {@link AuthorizationContextResolver}.
 *
 * Replaces the Phase 4 permission-less default resolver as the production
 * binding for `AUTHORIZATION_CONTEXT_RESOLVER`. It builds the caller's
 * {@link AuthorizationContext} entirely from trusted request state and database
 * records via {@link IdentityService}:
 *
 * - the verified auth user id from the principal (never a client value);
 * - the caller's real profile;
 * - active membership in the *requested* company only (a supplied company id is
 *   a target, never proof of membership);
 * - effective permissions derived server-side from the membership role(s).
 *
 * It fails closed — returning `null` for any unauthorized outcome so the guard
 * denies with `403` — and never converts a database failure into a denial:
 * exceptions from the identity layer propagate and surface as a dependency
 * error, distinct from a legitimate authorization denial.
 */
@Injectable()
export class DatabaseAuthorizationContextResolver
  implements AuthorizationContextResolver
{
  private readonly logger = new Logger(
    DatabaseAuthorizationContextResolver.name,
  );

  constructor(private readonly identity: IdentityService) {}

  async resolve(
    request: AuthorizationResolutionRequest,
  ): Promise<AuthorizationContext | null> {
    const { principal, companyId, requestId } = request;

    // Without a company target we can still resolve identity, but grant nothing:
    // every permission-protected route in this phase is company-scoped.
    if (companyId === undefined) {
      const profile = await this.identity.findActiveProfile(principal.userId);
      if (!profile) {
        this.logUnresolved(requestId, 'profile_unresolved');
        return null;
      }
      return {
        userId: principal.userId,
        profileId: profile.id,
        permissions: [],
      };
    }

    const context = await this.identity.resolveMembershipContext(
      principal.userId,
      companyId,
    );
    if (!context) {
      this.logUnresolved(requestId, 'membership_unresolved');
      return null;
    }

    // The authoritative grant is the union of every active membership's
    // permissions. `membershipId`/`role` are informational and are surfaced
    // only when a single active membership makes them unambiguous — no
    // "primary membership" rule is invented when the caller holds several.
    const single =
      context.memberships.length === 1 ? context.memberships[0] : undefined;

    return {
      userId: principal.userId,
      profileId: context.profile.id,
      companyId: context.companyId,
      membershipId: single?.id,
      role: single?.role,
      permissions: context.permissions,
    };
  }

  /** Sanitized: correlation id and a coarse reason only — no ids, roles or permissions. */
  private logUnresolved(requestId: string, reason: string): void {
    this.logger.debug({
      event: 'authorization_context_unresolved',
      requestId,
      reason,
    });
  }
}
