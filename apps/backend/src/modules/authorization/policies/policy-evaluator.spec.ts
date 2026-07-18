import type { AuthorizationContext } from '../authorization-context';
import {
  allow,
  deny,
  type AuthorizationPolicy,
} from './authorization-policy';
import { PolicyEvaluator } from './policy-evaluator';

const context: AuthorizationContext = {
  userId: 'user-1',
  profileId: 'profile-1',
  permissions: [],
};

function policy(name: string, allowed: boolean): AuthorizationPolicy {
  return { name, evaluate: () => (allowed ? allow() : deny(`${name}_denied`)) };
}

describe('PolicyEvaluator', () => {
  const evaluator = new PolicyEvaluator();

  it('allows when there are no policies', () => {
    expect(evaluator.evaluate([], context)).toEqual({ allowed: true });
  });

  it('allows only when every policy allows (conjunctive)', () => {
    const result = evaluator.evaluate(
      [policy('a', true), policy('b', true)],
      context,
    );
    expect(result.allowed).toBe(true);
  });

  it('returns the first denial and short-circuits', () => {
    const later = policy('later', false);
    const evaluateSpy = jest.spyOn(later, 'evaluate');

    const result = evaluator.evaluate(
      [policy('first', false), later],
      context,
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('first_denied');
    }
    expect(evaluateSpy).not.toHaveBeenCalled();
  });
});
