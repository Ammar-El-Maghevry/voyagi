import { PaymentReferenceGenerator } from './payment-reference.generator';

describe('PaymentReferenceGenerator', () => {
  const generator = new PaymentReferenceGenerator();

  it('produces a dated, prefixed reference', () => {
    const reference = generator.generate(new Date('2026-07-22T10:00:00Z'));
    expect(reference).toMatch(/^PAY-20260722-[0-9A-Z]{6}$/);
  });

  it('is effectively unique across many generations', () => {
    const references = new Set(Array.from({ length: 1000 }, () => generator.generate()));
    expect(references.size).toBe(1000);
  });
});
