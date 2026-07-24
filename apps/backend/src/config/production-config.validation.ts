/**
 * Startup-time PRODUCTION configuration validation.
 *
 * The per-namespace config already has safe local defaults and enforces some
 * invariants deep in the app (the pool factory throws on a missing
 * `DATABASE_URL`, the JWKS resolver on a missing URL). This module adds a single
 * fail-fast gate that runs only when `NODE_ENV=production` and rejects
 * dangerous or placeholder configuration BEFORE the server starts accepting
 * traffic.
 *
 * Design rules:
 *  - deterministic and pure over the raw environment, so it is fully testable;
 *  - error messages are actionable but NEVER contain a secret value — the
 *    database URL is redacted and secret values are referenced by name only.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** Asymmetric-only JWT algorithms. Symmetric (HS-family) and "none" are rejected. */
const ASYMMETRIC_ALG = /^(?:RS|ES|PS)(?:256|384|512)$|^EdDSA$/;
/** Accepted database URL protocols. */
const DB_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
/** Boolean spellings accepted by {@link parseBoolean} in the config layer. */
const TRUTHY = new Set(['true', '1', 'yes', 'on']);
const FALSY = new Set(['false', '0', 'no', 'off']);
/** Upper bound for a production request body limit (defense against abuse). */
const MAX_BODY_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB
const BYTE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.toLowerCase());
}

/** Redact credentials from a database URL, keeping only a safe shape hint. */
function redactDbUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const host = url.host || '(unknown-host)';
    return `${url.protocol}//***@${host}${url.pathname}`;
  } catch {
    return '(unparseable database url)';
  }
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/** Parse a size like `100kb` / `1mb` / `1048576` into bytes, or null if malformed. */
export function parseBodyLimitBytes(raw: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(raw.trim());
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (match[2] ?? 'b').toLowerCase();
  return Math.round(value * BYTE_UNITS[unit]);
}

/** Classify a boolean-ish string: `true`, `false`, or `null` when invalid. */
function parseBooleanStrict(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (TRUTHY.has(normalized)) return true;
  if (FALSY.has(normalized)) return false;
  return null;
}

function positiveIntViolation(
  env: NodeJS.ProcessEnv,
  key: string,
  violations: string[],
  { allowZero = false }: { allowZero?: boolean } = {},
): number | undefined {
  const raw = env[key];
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(value) || value < min) {
    violations.push(`${key} must be an integer >= ${min}.`);
    return undefined;
  }
  return value;
}

/**
 * Validate an https, non-local URL referenced by a config key. Pushes a
 * secret-free violation for each problem found.
 */
function validateHttpsUrl(
  label: string,
  raw: string,
  violations: string[],
): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    violations.push(`${label} must be a valid URL in production.`);
    return;
  }
  if (url.protocol !== 'https:') {
    violations.push(`${label} must use https in production.`);
  }
  if (isLocalHost(url.hostname)) {
    violations.push(`${label} must not point at a local host in production.`);
  }
}

/** Validate each boolean-typed variable's spelling; returns its parsed value. */
function validateBoolean(
  env: NodeJS.ProcessEnv,
  key: string,
  violations: string[],
): boolean | null {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = parseBooleanStrict(raw);
  if (parsed === null) {
    violations.push(`${key} must be a boolean (true/false).`);
  }
  return parsed;
}

/**
 * Collect all production configuration violations from a raw environment.
 * Returns an empty array when the configuration is production-safe. Contains no
 * secret values.
 */
export function collectProductionConfigViolations(
  env: NodeJS.ProcessEnv,
): string[] {
  const violations: string[] = [];

  // --- NODE_ENV -------------------------------------------------------------
  if (env.NODE_ENV !== 'production') {
    // This function is only meaningful in production; callers gate on it, but
    // guard defensively so a direct call is explicit.
    return [
      `NODE_ENV must be "production" (got "${env.NODE_ENV ?? 'unset'}").`,
    ];
  }

  // --- PORT -----------------------------------------------------------------
  if (env.PORT !== undefined && env.PORT !== '') {
    const port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      violations.push('PORT must be an integer between 1 and 65535.');
    }
  }

  // --- DATABASE_URL ---------------------------------------------------------
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl || dbUrl.trim() === '') {
    violations.push('DATABASE_URL is required in production but is not set.');
  } else {
    let url: URL | null = null;
    try {
      url = new URL(dbUrl);
    } catch {
      violations.push('DATABASE_URL is not a valid URL.');
    }
    if (url) {
      if (!DB_PROTOCOLS.has(url.protocol)) {
        violations.push(
          'DATABASE_URL must use the postgres:// or postgresql:// protocol.',
        );
      }
      if (isLocalHost(url.hostname)) {
        violations.push(
          `DATABASE_URL points at a local host (${url.hostname}); a production database must be used. [${redactDbUrl(dbUrl)}]`,
        );
      }
    }
  }

  // --- Database SSL policy --------------------------------------------------
  const sslMode = env.DATABASE_SSL_MODE ?? 'require'; // production default
  if (sslMode === 'disable') {
    violations.push(
      'DATABASE_SSL_MODE must not be "disable" in production (use require/verify-ca/verify-full).',
    );
  }

  // --- Database pool limits & timeouts --------------------------------------
  const poolMin = positiveIntViolation(env, 'DATABASE_POOL_MIN', violations, {
    allowZero: true,
  });
  const poolMax = positiveIntViolation(env, 'DATABASE_POOL_MAX', violations);
  if (poolMax !== undefined && poolMax < 1) {
    violations.push('DATABASE_POOL_MAX must be >= 1.');
  }
  if (poolMin !== undefined && poolMax !== undefined && poolMin > poolMax) {
    violations.push('DATABASE_POOL_MIN must be <= DATABASE_POOL_MAX.');
  }
  positiveIntViolation(env, 'DATABASE_CONNECTION_TIMEOUT_MS', violations);
  positiveIntViolation(env, 'DATABASE_STATEMENT_TIMEOUT_MS', violations);
  positiveIntViolation(env, 'DATABASE_READINESS_TIMEOUT_MS', violations);

  // --- Authentication (issuer / audience / JWKS / algorithms) ---------------
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const issuer = env.SUPABASE_JWT_ISSUER?.trim();
  const jwksUrl =
    env.SUPABASE_JWKS_URL?.trim() ||
    (supabaseUrl
      ? `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`
      : '');
  const resolvedIssuer =
    issuer || (supabaseUrl ? `${supabaseUrl.replace(/\/+$/, '')}/auth/v1` : '');

  if (!resolvedIssuer) {
    violations.push(
      'Authentication issuer is not configured: set SUPABASE_URL or SUPABASE_JWT_ISSUER.',
    );
  } else {
    // The issuer must be a real https, non-local URL — not an arbitrary string.
    validateHttpsUrl(
      'Authentication issuer (SUPABASE_JWT_ISSUER)',
      resolvedIssuer,
      violations,
    );
  }
  if (!jwksUrl) {
    violations.push(
      'JWKS URL is not configured: set SUPABASE_URL or SUPABASE_JWKS_URL.',
    );
  } else {
    validateHttpsUrl('JWKS URL (SUPABASE_JWKS_URL)', jwksUrl, violations);
  }
  if (
    env.SUPABASE_JWT_AUDIENCE !== undefined &&
    env.SUPABASE_JWT_AUDIENCE.trim() === ''
  ) {
    violations.push('SUPABASE_JWT_AUDIENCE must not be empty when set.');
  }
  const algorithms = splitList(env.SUPABASE_JWT_ALGORITHMS);
  for (const alg of algorithms) {
    if (!ASYMMETRIC_ALG.test(alg)) {
      violations.push(
        `SUPABASE_JWT_ALGORITHMS contains an unsupported/unsafe algorithm "${alg}" (only asymmetric RS*/ES*/PS*/EdDSA are allowed; HS*/none are rejected).`,
      );
    }
  }

  // --- Trusted proxy --------------------------------------------------------
  // Anonymous rate limiting keys on req.ip, so a permissive trust setting would
  // let a spoofed X-Forwarded-For shift buckets. Accept only unset or an
  // explicit positive hop count; reject `true` and any other string.
  if (env.TRUST_PROXY !== undefined && env.TRUST_PROXY.trim() !== '') {
    const value = env.TRUST_PROXY.trim();
    if (value.toLowerCase() === 'true') {
      violations.push(
        'TRUST_PROXY must not be "true" in production (use an explicit positive hop count).',
      );
    } else if (!/^[1-9]\d*$/.test(value)) {
      violations.push(
        'TRUST_PROXY must be an explicit positive integer hop count in production.',
      );
    }
  }

  // --- CORS -----------------------------------------------------------------
  const origins = splitList(env.CORS_ORIGINS);
  if (origins.length === 0) {
    violations.push(
      'CORS_ORIGINS must list at least one explicit origin in production (no wildcard fallback).',
    );
  }
  for (const origin of origins) {
    if (origin === '*') {
      violations.push(
        'CORS_ORIGINS must not contain a wildcard "*" in production.',
      );
      continue;
    }
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      violations.push(`CORS origin "${origin}" is not a valid origin URL.`);
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      violations.push(`CORS origin "${origin}" must be an http(s) origin.`);
    }
    if (url.username !== '' || url.password !== '') {
      violations.push(`CORS origin "${origin}" must not contain credentials.`);
    }
    if (url.pathname !== '/' && url.pathname !== '') {
      violations.push(`CORS origin "${origin}" must not contain a path.`);
    }
    if (url.search !== '') {
      violations.push(
        `CORS origin "${origin}" must not contain a query string.`,
      );
    }
    if (url.hash !== '') {
      violations.push(`CORS origin "${origin}" must not contain a fragment.`);
    }
  }

  // --- Request body limit ---------------------------------------------------
  if (env.BODY_LIMIT !== undefined && env.BODY_LIMIT.trim() !== '') {
    const bytes = parseBodyLimitBytes(env.BODY_LIMIT);
    if (bytes === null) {
      violations.push(
        'BODY_LIMIT must be a byte count or size like "100kb" / "1mb".',
      );
    } else if (bytes <= 0) {
      violations.push('BODY_LIMIT must be greater than zero.');
    } else if (bytes > MAX_BODY_LIMIT_BYTES) {
      violations.push(
        `BODY_LIMIT must not exceed ${MAX_BODY_LIMIT_BYTES} bytes (10mb) in production.`,
      );
    }
  }

  // --- Rate limits (global + any category override) -------------------------
  positiveIntViolation(env, 'RATE_LIMIT_TTL', violations);
  positiveIntViolation(env, 'RATE_LIMIT_LIMIT', violations);
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('RATE_LIMIT_') &&
      key !== 'RATE_LIMIT_TTL' &&
      key !== 'RATE_LIMIT_LIMIT'
    ) {
      positiveIntViolation(env, key, violations);
    }
  }

  // --- Payments -------------------------------------------------------------
  // The deterministic test provider must never run in production; a real
  // provider adapter is a later phase. Reject test mode outright here.
  const paymentsMode = env.PAYMENTS_PROVIDER_MODE?.trim().toLowerCase();
  if (paymentsMode === 'test') {
    violations.push(
      'PAYMENTS_PROVIDER_MODE must not be "test" in production (real payments remain disabled until a provider adapter is supplied).',
    );
  } else if (
    paymentsMode !== undefined &&
    paymentsMode !== '' &&
    paymentsMode !== 'disabled'
  ) {
    violations.push('PAYMENTS_PROVIDER_MODE must be "disabled" in production.');
  }

  // --- Boolean-typed variables ---------------------------------------------
  validateBoolean(env, 'CORS_CREDENTIALS', violations);
  validateBoolean(env, 'SWAGGER_ENABLED', violations);
  const logPretty = validateBoolean(env, 'LOG_PRETTY', violations);
  if (logPretty === true) {
    violations.push(
      'LOG_PRETTY must not be true in production (structured JSON logs only).',
    );
  }
  const logQueries = validateBoolean(env, 'DATABASE_LOG_QUERIES', violations);
  if (logQueries === true) {
    violations.push(
      'DATABASE_LOG_QUERIES must not be true in production (avoid logging SQL text).',
    );
  }

  // --- Logging level --------------------------------------------------------
  if (env.LOG_LEVEL !== undefined) {
    const valid = [
      'fatal',
      'error',
      'warn',
      'info',
      'debug',
      'trace',
      'silent',
    ];
    if (!valid.includes(env.LOG_LEVEL)) {
      violations.push(
        `LOG_LEVEL "${env.LOG_LEVEL}" is not a valid pino level.`,
      );
    }
  }

  // --- Shutdown deadline ----------------------------------------------------
  if (env.SHUTDOWN_TIMEOUT_MS !== undefined && env.SHUTDOWN_TIMEOUT_MS !== '') {
    const value = Number(env.SHUTDOWN_TIMEOUT_MS);
    if (!Number.isInteger(value) || value < 1000 || value > 120000) {
      violations.push(
        'SHUTDOWN_TIMEOUT_MS must be an integer between 1000 and 120000.',
      );
    }
  }

  return violations;
}

/**
 * Fail fast when running in production with unsafe configuration. No-op outside
 * production. Throws a single aggregated, secret-free error.
 */
export function assertProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== 'production') return;
  const violations = collectProductionConfigViolations(env);
  if (violations.length > 0) {
    const details = violations.map((v) => `  - ${v}`).join('\n');
    throw new Error(
      `Refusing to start: invalid production configuration:\n${details}`,
    );
  }
}
