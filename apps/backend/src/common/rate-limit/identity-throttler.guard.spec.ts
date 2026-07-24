import { IdentityThrottlerGuard } from './identity-throttler.guard';

/**
 * Anonymous rate-limit identity (Phase 18.1 hardening): the tracker keys
 * anonymous callers on `req.ip` only. Express derives `req.ip` from the socket
 * (honoring the configured `trust proxy` hop count), so a spoofed
 * `X-Forwarded-For` cannot move a caller into a different bucket under the
 * accepted production configuration (trust proxy off, or a fixed positive hop
 * count). Authenticated callers key on a one-way hash of the bearer token.
 */
describe('IdentityThrottlerGuard.getTracker', () => {
  // getTracker is protected and only reads req.headers/req.ip, so we can invoke
  // it on a prototype instance without the Nest DI constructor.
  const guard = Object.create(
    IdentityThrottlerGuard.prototype,
  ) as IdentityThrottlerGuard;
  const track = (req: Record<string, unknown>): Promise<string> =>
    (
      guard as unknown as { getTracker(r: unknown): Promise<string> }
    ).getTracker(req);

  it('keys anonymous callers on req.ip, ignoring X-Forwarded-For', async () => {
    const base = { ip: '203.0.113.7', headers: {} as Record<string, unknown> };
    const spoofed = {
      ip: '203.0.113.7',
      headers: { 'x-forwarded-for': '10.0.0.1, 8.8.8.8, evil' },
    };
    const spoofed2 = {
      ip: '203.0.113.7',
      headers: { 'x-forwarded-for': 'attacker-controlled' },
    };

    const a = await track(base);
    const b = await track(spoofed);
    const c = await track(spoofed2);

    expect(a).toBe('net:203.0.113.7');
    // A changing X-Forwarded-For never shifts the bucket.
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('separates different network addresses', async () => {
    const a = await track({ ip: '203.0.113.7', headers: {} });
    const b = await track({ ip: '203.0.113.8', headers: {} });
    expect(a).not.toBe(b);
  });

  it('keys authenticated callers on a token hash, not the network address', async () => {
    const a = await track({
      ip: '203.0.113.7',
      headers: { authorization: 'Bearer token-one' },
    });
    const b = await track({
      ip: '198.51.100.9', // different IP, same token
      headers: { authorization: 'Bearer token-one' },
    });
    const c = await track({
      ip: '203.0.113.7',
      headers: { authorization: 'Bearer token-two' },
    });

    expect(a).toMatch(/^tok:[0-9a-f]{32}$/);
    // Same token → same bucket regardless of IP.
    expect(a).toBe(b);
    // Different tokens → different buckets.
    expect(a).not.toBe(c);
    // The raw token never appears in the tracker key.
    expect(a).not.toContain('token-one');
  });
});
