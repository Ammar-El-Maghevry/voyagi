import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import { JwksUnavailableError } from '../../src/modules/auth/auth.errors';
import { JwtVerifierService } from '../../src/modules/auth/jwt-verifier.service';
import { createJwksKeyResolver } from '../../src/modules/auth/jwks-key-resolver.provider';
import {
  generateTestKey,
  jwksDocument,
  signTestToken,
  type TestSigningKey,
} from '../support/auth-test-keys';

/**
 * Integration tests for the remote JWKS verification path, using a real local
 * HTTP JWKS server (no production Supabase dependency). Exercises retrieval,
 * caching, rotation, unknown-kid, and unavailability. Deterministic and leaves
 * no residue (the server is closed in afterEach).
 */
describe('Remote JWKS verification (integration)', () => {
  const AUDIENCE = 'authenticated';

  let server: Server;
  let jwksBody: string;
  let requestCount = 0;
  let baseUrl: string;
  let issuer: string;

  async function startServer(behavior?: {
    status?: number;
    delayMs?: number;
  }): Promise<void> {
    server = createServer((_req, res) => {
      requestCount += 1;
      if (behavior?.status && behavior.status !== 200) {
        res.statusCode = behavior.status;
        res.end('error');
        return;
      }
      const send = () => {
        res.setHeader('content-type', 'application/json');
        res.end(jwksBody);
      };
      if (behavior?.delayMs) {
        setTimeout(send, behavior.delayMs);
      } else {
        send();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
    issuer = `${baseUrl}/auth/v1`;
  }

  function buildVerifier(overrides: Record<string, unknown> = {}): {
    verifier: JwtVerifierService;
  } {
    const config = {
      getOrThrow: () => ({
        issuer,
        audience: AUDIENCE,
        algorithms: ['ES256'],
        clockToleranceSeconds: 5,
        jwksUrl: `${baseUrl}/jwks`,
        jwksTimeoutMs: 500,
        jwksCacheTtlMs: 600_000,
        // No cooldown so key rotation (refetch on an unknown kid) is exercised
        // deterministically rather than being suppressed by jose's default.
        jwksCooldownMs: 0,
        ...overrides,
      }),
    } as unknown as ConfigService;
    const resolver = createJwksKeyResolver(config);
    return { verifier: new JwtVerifierService(resolver, config) };
  }

  const tokenFor = (key: TestSigningKey, subject = 'user-1') =>
    signTestToken(key, { issuer, audience: AUDIENCE, subject });

  afterEach(async () => {
    requestCount = 0;
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('retrieves keys and verifies a token', async () => {
    const key = await generateTestKey('k1', 'ES256');
    jwksBody = JSON.stringify(jwksDocument(key));
    await startServer();

    const { verifier } = buildVerifier();
    const principal = await verifier.verify(await tokenFor(key));

    expect(principal.userId).toBe('user-1');
    expect(requestCount).toBe(1);
  });

  it('caches the JWKS across verifications (single fetch)', async () => {
    const key = await generateTestKey('k1', 'ES256');
    jwksBody = JSON.stringify(jwksDocument(key));
    await startServer();

    const { verifier } = buildVerifier();
    await verifier.verify(await tokenFor(key));
    await verifier.verify(await tokenFor(key, 'user-2'));

    expect(requestCount).toBe(1);
  });

  it('handles key rotation by refetching on an unknown kid', async () => {
    const oldKey = await generateTestKey('old', 'ES256');
    const newKey = await generateTestKey('new', 'ES256');
    jwksBody = JSON.stringify(jwksDocument(oldKey));
    await startServer();

    const { verifier } = buildVerifier();
    await verifier.verify(await tokenFor(oldKey)); // fetch #1

    // Rotate the published keys, then present a token signed by the new key.
    jwksBody = JSON.stringify(jwksDocument(oldKey, newKey));
    const principal = await verifier.verify(await tokenFor(newKey)); // refetch

    expect(principal.userId).toBe('user-1');
    expect(requestCount).toBeGreaterThanOrEqual(2);
  });

  it('rejects a token whose kid is not in the JWKS', async () => {
    const known = await generateTestKey('known', 'ES256');
    const unknown = await generateTestKey('ghost', 'ES256');
    jwksBody = JSON.stringify(jwksDocument(known));
    await startServer();

    const { verifier } = buildVerifier();
    await expect(verifier.verify(await tokenFor(unknown))).rejects.toMatchObject(
      { reason: 'signature_invalid' },
    );
  });

  it('fails closed when the JWKS endpoint is unavailable', async () => {
    const key = await generateTestKey('k1', 'ES256');
    jwksBody = JSON.stringify(jwksDocument(key));
    await startServer({ status: 500 });

    const { verifier } = buildVerifier();
    await expect(verifier.verify(await tokenFor(key))).rejects.toBeInstanceOf(
      JwksUnavailableError,
    );
  });

  it('fails closed when the JWKS fetch exceeds the timeout', async () => {
    const key = await generateTestKey('k1', 'ES256');
    jwksBody = JSON.stringify(jwksDocument(key));
    await startServer({ delayMs: 300 });

    const { verifier } = buildVerifier({ jwksTimeoutMs: 50 });
    await expect(verifier.verify(await tokenFor(key))).rejects.toBeInstanceOf(
      JwksUnavailableError,
    );
  });
});
