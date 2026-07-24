import {
  describeTestSecretProblem,
  MIN_TEST_SECRET_LENGTH,
  PLACEHOLDER_WEBHOOK_SECRET,
  resolvePaymentsProviderMode,
  resolveTestWebhookSecret,
} from './payments.provider-config';

/** A secret long enough to pass the length check and not a placeholder. */
const STRONG_SECRET = 'x9Q2_strong-test-secret-value-01';

describe('resolvePaymentsProviderMode', () => {
  it('defaults to disabled in production', () => {
    expect(resolvePaymentsProviderMode({ NODE_ENV: 'production' })).toBe(
      'disabled',
    );
  });

  it('never honors test mode in production (defense-in-depth)', () => {
    expect(
      resolvePaymentsProviderMode({
        NODE_ENV: 'production',
        PAYMENTS_PROVIDER_MODE: 'test',
      }),
    ).toBe('disabled');
  });

  it('honors an explicit disabled mode in production', () => {
    expect(
      resolvePaymentsProviderMode({
        NODE_ENV: 'production',
        PAYMENTS_PROVIDER_MODE: 'disabled',
      }),
    ).toBe('disabled');
  });

  it('defaults to test outside production', () => {
    expect(resolvePaymentsProviderMode({ NODE_ENV: 'development' })).toBe(
      'test',
    );
    expect(resolvePaymentsProviderMode({ NODE_ENV: 'test' })).toBe('test');
  });

  it('honors an explicit disabled mode outside production', () => {
    expect(
      resolvePaymentsProviderMode({
        NODE_ENV: 'test',
        PAYMENTS_PROVIDER_MODE: 'disabled',
      }),
    ).toBe('disabled');
  });
});

describe('describeTestSecretProblem', () => {
  it('rejects an empty secret', () => {
    expect(describeTestSecretProblem('')).toMatch(/empty/);
    expect(describeTestSecretProblem('   ')).toMatch(/empty/);
  });

  it('rejects the built-in placeholder and other known placeholders', () => {
    for (const value of [
      PLACEHOLDER_WEBHOOK_SECRET,
      'secret',
      'changeme',
      'test',
      'password',
    ]) {
      expect(describeTestSecretProblem(value)).toMatch(/placeholder/);
    }
  });

  it('rejects a too-short secret', () => {
    expect(describeTestSecretProblem('short')).toMatch(
      new RegExp(String(MIN_TEST_SECRET_LENGTH)),
    );
  });

  it('accepts a strong secret', () => {
    expect(describeTestSecretProblem(STRONG_SECRET)).toBeNull();
  });

  it('never echoes the secret value in the problem string', () => {
    const problem = describeTestSecretProblem('short') ?? '';
    expect(problem).not.toContain('short');
  });
});

describe('resolveTestWebhookSecret', () => {
  it('returns an explicitly provided strong secret unchanged', () => {
    expect(
      resolveTestWebhookSecret({ PAYMENTS_TEST_WEBHOOK_SECRET: STRONG_SECRET }),
    ).toBe(STRONG_SECRET);
  });

  it('throws (secret-free) when the provided secret is the placeholder', () => {
    expect(() =>
      resolveTestWebhookSecret({
        PAYMENTS_TEST_WEBHOOK_SECRET: PLACEHOLDER_WEBHOOK_SECRET,
      }),
    ).toThrow(/PAYMENTS_TEST_WEBHOOK_SECRET/);
    try {
      resolveTestWebhookSecret({
        PAYMENTS_TEST_WEBHOOK_SECRET: PLACEHOLDER_WEBHOOK_SECRET,
      });
    } catch (error) {
      expect((error as Error).message).not.toContain(
        PLACEHOLDER_WEBHOOK_SECRET,
      );
    }
  });

  it('throws when the provided secret is too short', () => {
    expect(() =>
      resolveTestWebhookSecret({ PAYMENTS_TEST_WEBHOOK_SECRET: 'short' }),
    ).toThrow(/PAYMENTS_TEST_WEBHOOK_SECRET/);
  });

  it('throws when the secret is missing (no random/ephemeral fallback)', () => {
    expect(() => resolveTestWebhookSecret({})).toThrow(
      /PAYMENTS_TEST_WEBHOOK_SECRET is required/,
    );
  });

  it('throws when the secret is blank', () => {
    expect(() =>
      resolveTestWebhookSecret({ PAYMENTS_TEST_WEBHOOK_SECRET: '   ' }),
    ).toThrow(/PAYMENTS_TEST_WEBHOOK_SECRET is required/);
  });

  it('is deterministic — the same explicit secret resolves unchanged', () => {
    const env = { PAYMENTS_TEST_WEBHOOK_SECRET: STRONG_SECRET };
    expect(resolveTestWebhookSecret(env)).toBe(resolveTestWebhookSecret(env));
  });

  it('never echoes the missing-secret error with any value', () => {
    let message = '';
    try {
      resolveTestWebhookSecret({});
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('PAYMENTS_TEST_WEBHOOK_SECRET');
    expect(message).not.toContain(STRONG_SECRET);
  });
});
