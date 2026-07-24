/**
 * Payment-provider registration mode.
 *  - `disabled`: no provider adapter is registered; every payment mutation fails
 *    safely. This is the production default until a real provider adapter and
 *    credentials are supplied.
 *  - `test`: the deterministic in-process {@link TestPaymentProvider} is
 *    registered for local development and automated tests. Never honored in
 *    production.
 */
export type PaymentsProviderMode = 'disabled' | 'test';

/** The built-in placeholder that must NEVER be used as a shared secret. */
export const PLACEHOLDER_WEBHOOK_SECRET = 'voyagi-test-webhook-secret';

/** Obvious placeholder secrets rejected whenever test mode is enabled. */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'secret',
  'changeme',
  'change-me',
  'test',
  'password',
  'placeholder',
  PLACEHOLDER_WEBHOOK_SECRET,
]);

/** Minimum length for an explicitly supplied test-provider secret. */
export const MIN_TEST_SECRET_LENGTH = 16;

/**
 * Resolve the payment-provider mode from the environment.
 *  - production defaults to `disabled`, and `test` is never honored here
 *    (production config validation rejects `test` before boot; forcing
 *    `disabled` again is defense-in-depth so the test adapter can never be
 *    registered in production);
 *  - non-production defaults to `test` for deterministic local development and
 *    automated tests.
 */
export function resolvePaymentsProviderMode(
  env: NodeJS.ProcessEnv,
): PaymentsProviderMode {
  const isProduction = env.NODE_ENV === 'production';
  const raw = env.PAYMENTS_PROVIDER_MODE?.trim().toLowerCase();
  if (raw === 'disabled') return 'disabled';
  if (raw === 'test') return isProduction ? 'disabled' : 'test';
  return isProduction ? 'disabled' : 'test';
}

/**
 * Describe why a test-provider secret is unsafe, or `null` when it is
 * acceptable. Never returns or echoes the secret value itself.
 */
export function describeTestSecretProblem(secret: string): string | null {
  const trimmed = secret.trim();
  if (trimmed.length === 0) return 'must not be empty';
  if (KNOWN_PLACEHOLDER_SECRETS.has(trimmed.toLowerCase())) {
    return 'must not be a known placeholder value';
  }
  if (trimmed.length < MIN_TEST_SECRET_LENGTH) {
    return `must be at least ${MIN_TEST_SECRET_LENGTH} characters long`;
  }
  return null;
}

/**
 * Resolve the shared secret for the deterministic TestPaymentProvider when test
 * mode is enabled.
 *
 * `PAYMENTS_TEST_WEBHOOK_SECRET` MUST be supplied explicitly: a missing, blank,
 * known-placeholder, or too-short value fails startup. There is NO random or
 * ephemeral fallback — automated tests and local development provide an explicit
 * synthetic value. The thrown error names only the variable and the rule, never
 * the supplied value.
 *
 * This function is only called when the provider mode is `test`; `disabled` mode
 * never resolves a secret, so production (which defaults to `disabled` and
 * rejects `test`) can start without `PAYMENTS_TEST_WEBHOOK_SECRET`.
 */
export function resolveTestWebhookSecret(env: NodeJS.ProcessEnv): string {
  const provided = env.PAYMENTS_TEST_WEBHOOK_SECRET;
  if (provided === undefined || provided.trim() === '') {
    throw new Error(
      'PAYMENTS_TEST_WEBHOOK_SECRET is required when PAYMENTS_PROVIDER_MODE=test.',
    );
  }
  const problem = describeTestSecretProblem(provided);
  if (problem) {
    // Reference the variable by name only — never include the value.
    throw new Error(`PAYMENTS_TEST_WEBHOOK_SECRET ${problem}.`);
  }
  return provided;
}
