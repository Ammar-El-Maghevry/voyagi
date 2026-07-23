import type { PoolClient } from 'pg';

/**
 * Helpers that switch the PostgreSQL session between the real, non-bypassing
 * roles used by Supabase RLS. Every helper is explicit and self-contained: a
 * test sets exactly the identity it needs, so suites never depend on execution
 * order. `set_config(..., true)` scopes the claim to the current transaction, and
 * {@link resetSession} clears it between cases.
 *
 * `auth.uid()` in the local stack reads `request.jwt.claim.sub`; that is the same
 * mechanism the pgTAP suite relies on, so these helpers exercise the genuine
 * policy predicates rather than any mock.
 */

/** Run subsequent statements as `authenticated` acting as `userId`. */
export async function asAuthenticated(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query('select set_config($1, $2, true)', [
    'request.jwt.claim.sub',
    userId,
  ]);
  await client.query('set local role authenticated');
}

/** Run subsequent statements as the anonymous (`anon`) role. */
export async function asAnon(client: PoolClient): Promise<void> {
  await client.query('select set_config($1, $2, true)', [
    'request.jwt.claim.sub',
    '',
  ]);
  await client.query('set local role anon');
}

/**
 * Return to the privileged connecting role (used only for seeding/setup) and
 * clear the impersonated subject. Never used as proof of `authenticated`
 * behavior.
 */
export async function resetSession(client: PoolClient): Promise<void> {
  await client.query('reset role');
  await client.query('select set_config($1, $2, true)', [
    'request.jwt.claim.sub',
    '',
  ]);
}

/** Count rows a role can SELECT from `table` under the given filter. */
export async function countVisible(
  client: PoolClient,
  table: string,
  where: string,
  params: unknown[] = [],
): Promise<number> {
  const result = await client.query<{ c: string }>(
    `select count(*)::text as c from public.${table} where ${where}`,
    params,
  );
  return Number(result.rows[0].c);
}

/** Result of attempting a write: either a PostgreSQL error code or 'ok'. */
export interface WriteAttempt {
  code: string | 'ok';
  rowCount: number;
}

/**
 * Attempt an arbitrary write and capture the outcome without aborting the outer
 * transaction (wrapped in a savepoint that is rolled back on error).
 */
export async function attemptWrite(
  client: PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<WriteAttempt> {
  await client.query('savepoint write_probe');
  try {
    const result = await client.query(sql, params);
    await client.query('release savepoint write_probe');
    return { code: 'ok', rowCount: result.rowCount ?? 0 };
  } catch (error) {
    await client.query('rollback to savepoint write_probe');
    const code =
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : 'unknown';
    return { code, rowCount: 0 };
  }
}
