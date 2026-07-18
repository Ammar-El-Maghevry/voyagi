import { Module } from '@nestjs/common';
import { AUTHORIZATION_CONTEXT_RESOLVER } from './authorization-context-resolver';
import { DefaultAuthorizationContextResolver } from './default-authorization-context.resolver';
import { PolicyEvaluator } from './policies/policy-evaluator';

/**
 * Authorization module.
 *
 * Provides the reusable authorization primitives — the policy evaluator and the
 * default context resolver — and exports them so the globally-registered
 * {@link AuthorizationGuard} (wired by the app module) can resolve them.
 *
 * `AUTHORIZATION_CONTEXT_RESOLVER` is bound to a minimal, permission-less
 * default so authorization is functional out of the box. The identity/tenant
 * phase replaces it through DI by binding a database-backed resolver to the
 * same token (a locally-provided binding takes precedence over this export).
 */
@Module({
  providers: [
    PolicyEvaluator,
    {
      provide: AUTHORIZATION_CONTEXT_RESOLVER,
      useClass: DefaultAuthorizationContextResolver,
    },
  ],
  exports: [PolicyEvaluator, AUTHORIZATION_CONTEXT_RESOLVER],
})
export class AuthorizationModule {}
