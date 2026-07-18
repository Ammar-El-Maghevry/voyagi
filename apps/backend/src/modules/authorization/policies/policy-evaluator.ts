import { Injectable } from '@nestjs/common';
import type { AuthorizationContext } from '../authorization-context';
import { allow, type AuthorizationPolicy, type PolicyResult } from './authorization-policy';

/**
 * Evaluates a set of authorization policies against a resolved context.
 *
 * Combination is conjunctive with short-circuit: access is granted only if
 * every policy allows, and the first denial is returned (so its reason can be
 * logged). An empty policy set allows — callers decide when authorization is
 * required. This is the single place where policy composition lives, so future
 * policy kinds compose without changing the guard.
 */
@Injectable()
export class PolicyEvaluator {
  evaluate(
    policies: readonly AuthorizationPolicy[],
    context: AuthorizationContext,
  ): PolicyResult {
    for (const policy of policies) {
      const result = policy.evaluate(context);
      if (!result.allowed) {
        return result;
      }
    }
    return allow();
  }
}
