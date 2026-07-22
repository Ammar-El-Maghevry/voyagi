import { sanitizeAuditMetadata } from './audit.metadata';

describe('sanitizeAuditMetadata', () => {
  it('allows only the explicit metadata vocabulary', () => {
    expect(
      sanitizeAuditMetadata({
        status: 'CONFIRMED',
        tripId: '42',
        fullName: 'Must not be retained',
      }),
    ).toEqual({ status: 'CONFIRMED', tripId: '42' });
  });

  it('drops sensitive keys recursively, including nested objects and arrays', () => {
    expect(
      sanitizeAuditMetadata({
        changes: {
          status: 'PAID',
          token: 'private',
          fields: [{ paymentId: '9', passengerPhone: '+22236000000' }],
        },
        card: '4111111111111111',
      }),
    ).toEqual({
      changes: { status: 'PAID', fields: [{ paymentId: '9' }] },
    });
  });

  it('rejects non-object roots and non-JSON values', () => {
    expect(sanitizeAuditMetadata(['status'])).toBeNull();
    expect(sanitizeAuditMetadata({ status: Number.NaN, changes: new Date() })).toEqual(
      {},
    );
  });
});
