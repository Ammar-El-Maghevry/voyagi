// Deterministic, quiet environment for the e2e suite. Set before the app and
// its configuration are loaded.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.LOG_PRETTY = 'false';
process.env.SWAGGER_ENABLED = 'false';
