import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Raw QR token entropy: 32 bytes → 256 bits, base64url encoded. */
const TOKEN_BYTES = 32;

export interface GeneratedToken {
  /** The raw token — returned to the client exactly once, never persisted. */
  readonly raw: string;
  /** The SHA-256 hex hash — the only token material stored (`qr_token_hash`). */
  readonly hash: string;
}

/**
 * Cryptographic QR-token material for tickets. The raw token is high-entropy and
 * independent of any ticket/booking id, so it cannot be guessed or derived. Only
 * its hash is persisted; the raw value is returned once at issuance and never
 * logged, stored, or re-derivable.
 */
@Injectable()
export class TicketTokenService {
  /** Hash a raw token for storage or constant-time-equivalent lookup by hash. */
  hash(raw: string): string {
    return createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  /** Generate a fresh raw token and its storage hash. */
  generateToken(): GeneratedToken {
    const raw = randomBytes(TOKEN_BYTES).toString('base64url');
    return { raw, hash: this.hash(raw) };
  }

  /** Generate a unique, human-readable ticket number (`TKT-YYYYMMDD-XXXXXX`). */
  generateTicketNumber(now = new Date()): string {
    const date = now.toISOString().slice(0, 10).replaceAll('-', '');
    let suffix = '';
    while (suffix.length < 6) {
      for (const value of randomBytes(8)) {
        if (value < 252) suffix += ALPHABET[value % ALPHABET.length];
        if (suffix.length === 6) break;
      }
    }
    return `TKT-${date}-${suffix}`;
  }
}
