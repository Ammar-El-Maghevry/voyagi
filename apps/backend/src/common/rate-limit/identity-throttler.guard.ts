import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Rate-limit tracker that separates callers safely.
 *
 * The throttler runs BEFORE authentication, so a verified principal is not yet
 * available. Instead of trusting any client-supplied identity, it keys on a
 * one-way hash of the bearer token when present (so two different users — hence
 * different tokens — never share a bucket) and otherwise on the network address
 * (`req.ip`, which honours the configured `trust proxy` and is therefore not
 * affected by spoofed `X-Forwarded-For` headers when proxying is disabled).
 *
 * The tracker value is an internal key only: neither the raw token nor the hash
 * is logged or returned to the client, and a `429` exposes no key material.
 */
@Injectable()
export class IdentityThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    const auth = request.headers?.authorization;
    if (typeof auth === 'string' && auth.length > 0) {
      const digest = createHash('sha256')
        .update(auth)
        .digest('hex')
        .slice(0, 32);
      return Promise.resolve(`tok:${digest}`);
    }
    return Promise.resolve(`net:${request.ip ?? 'unknown'}`);
  }
}
