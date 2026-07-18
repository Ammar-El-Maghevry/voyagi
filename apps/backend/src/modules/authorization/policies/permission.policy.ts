import type { AuthorizationContext } from '../authorization-context';
import {
  allow,
  deny,
  type AuthorizationPolicy,
  type PolicyResult,
} from './authorization-policy';

/**
 * Grants access only when the context holds every required permission
 * (conjunctive / all-of semantics). An empty requirement set trivially allows.
 */
export class PermissionPolicy implements AuthorizationPolicy {
  readonly name = 'permission';

  private readonly required: readonly string[];

  constructor(required: readonly string[]) {
    this.required = required;
  }

  evaluate(context: AuthorizationContext): PolicyResult {
    const granted = new Set(context.permissions);
    const missing = this.required.filter(
      (permission) => !granted.has(permission),
    );

    return missing.length === 0
      ? allow()
      : deny(`missing_permissions:${missing.join(',')}`);
  }
}
