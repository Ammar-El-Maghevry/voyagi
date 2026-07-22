import { isUuid, parsePositiveBigInt } from './identifier.util';

describe('identifier.util', () => {
  describe('isUuid', () => {
    it('accepts a canonical UUID', () => {
      expect(isUuid('11111111-2222-4333-8444-555555555555')).toBe(true);
    });

    it('rejects non-UUID subjects (e.g. test tokens)', () => {
      expect(isUuid('user-123')).toBe(false);
      expect(isUuid('')).toBe(false);
      expect(isUuid('11111111-2222-4333-8444-55555555555')).toBe(false);
    });
  });

  describe('parsePositiveBigInt', () => {
    it('returns the normalized value for a valid positive integer', () => {
      expect(parsePositiveBigInt('1')).toBe('1');
      expect(parsePositiveBigInt('9007199254740993')).toBe('9007199254740993');
    });

    it('rejects zero, negatives, leading zeros and non-numerics', () => {
      expect(parsePositiveBigInt('0')).toBeNull();
      expect(parsePositiveBigInt('-5')).toBeNull();
      expect(parsePositiveBigInt('01')).toBeNull();
      expect(parsePositiveBigInt('abc')).toBeNull();
      expect(parsePositiveBigInt('1.5')).toBeNull();
      expect(parsePositiveBigInt('')).toBeNull();
    });

    it('rejects values beyond the bigint range', () => {
      expect(parsePositiveBigInt('9223372036854775807')).toBe(
        '9223372036854775807',
      );
      expect(parsePositiveBigInt('9223372036854775808')).toBeNull();
    });
  });
});
