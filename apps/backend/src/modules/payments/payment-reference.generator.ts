import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Generates the internal payment reference (`payments.internal_reference`, a
 * unique non-blank text). Format `PAY-YYYYMMDD-XXXXXX` with a rejection-sampled,
 * bias-free base-36 suffix. This is an internal correlation id and never a
 * secret: it may appear in responses and logs (unlike idempotency keys,
 * fingerprints and QR tokens, which never do).
 */
@Injectable()
export class PaymentReferenceGenerator {
  generate(now = new Date()): string {
    const date = now.toISOString().slice(0, 10).replaceAll('-', '');
    let suffix = '';
    while (suffix.length < 6) {
      for (const value of randomBytes(8)) {
        // 252 is the largest multiple of 36 below 256; rejection avoids modulo bias.
        if (value < 252) suffix += ALPHABET[value % ALPHABET.length];
        if (suffix.length === 6) break;
      }
    }
    return `PAY-${date}-${suffix}`;
  }
}
