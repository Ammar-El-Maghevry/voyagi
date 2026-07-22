import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

@Injectable()
export class BookingReferenceGenerator {
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
    return `VYG-${date}-${suffix}`;
  }
}
