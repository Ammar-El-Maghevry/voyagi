import { BookingReferenceGenerator } from './booking-reference.generator';

describe('BookingReferenceGenerator', () => {
  it('generates the documented server-side reference shape', () => {
    const reference = new BookingReferenceGenerator().generate(
      new Date('2026-07-22T10:00:00.000Z'),
    );

    expect(reference).toMatch(/^VYG-20260722-[0-9A-Z]{6}$/);
  });
});
