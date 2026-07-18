import { Injectable } from '@nestjs/common';
import type { AuthorizationContext } from './authorization-context';
import type {
  AuthorizationContextResolver,
  AuthorizationResolutionRequest,
} from './authorization-context-resolver';

/**
 * Default authorization-context resolver.
 *
 * Keeps the authorization pipeline fully functional before the identity/tenant
 * phase exists, without introducing any Users/Memberships domain: it resolves a
 * valid context for every authenticated caller directly from the verified
 * {@link AuthenticatedPrincipal}, granting **no** permissions.
 *
 * The result is deterministic and secure by default — permission-protected
 * routes receive a correct authorization decision (`403 Forbidden`, because no
 * permission is granted) rather than failing as an unavailable dependency. It
 * deliberately does not infer permissions, roles, or memberships from token
 * metadata (the backend must not trust unverified authorization claims).
 *
 * Phase 5 replaces this by binding a database-backed resolver to
 * {@link AUTHORIZATION_CONTEXT_RESOLVER}; no other code changes.
 */
@Injectable()
export class DefaultAuthorizationContextResolver
  implements AuthorizationContextResolver
{
  async resolve(
    request: AuthorizationResolutionRequest,
  ): Promise<AuthorizationContext> {
    return {
      userId: request.principal.userId,
      permissions: [],
    };
  }
}
