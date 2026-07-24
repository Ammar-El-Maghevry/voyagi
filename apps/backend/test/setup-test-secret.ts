// Deterministic, shell-independent test configuration for the payment provider.
//
// Suites that compile AppModule run in test mode (PAYMENTS_PROVIDER_MODE
// defaults to `test`), which requires an explicit PAYMENTS_TEST_WEBHOOK_SECRET —
// there is no random/ephemeral fallback. This setup supplies a clearly SYNTHETIC
// test-only value so the suites never depend on the developer's shell.
//
// This is throwaway test-fixture material, NOT a real secret: it is set only in
// test setup, never in production config, the Docker image, or logs. Real local
// development should generate a unique value rather than copy this one.
//
// Set unconditionally so the suites are deterministic and independent of any
// value in the developer's shell. Tests that exercise the "missing secret" path
// delete this variable at runtime after setup has run.
process.env.PAYMENTS_TEST_WEBHOOK_SECRET = 'voyagi-local-test-webhook-key-0001';
