import { WebhookSignatureInvalidError } from './payment.errors';
import { ProviderEventOutcome } from './payment-provider.port';
import { PaymentMethod } from './payment.types';
import { TEST_SIGNATURE_HEADER, TestPaymentProvider } from './test-payment.provider';

const SECRET = 'unit-test-secret';

function event(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      eventId: 'evt_1',
      internalReference: 'PAY-20260722-ABCDEF',
      providerReference: 'test_PAY-20260722-ABCDEF',
      outcome: ProviderEventOutcome.Succeeded,
      amount: '1000.00',
      currency: 'MRU',
      ...overrides,
    }),
  );
}

describe('TestPaymentProvider', () => {
  const provider = new TestPaymentProvider(SECRET);

  it('handles only online methods', () => {
    expect(provider.handlesMethod(PaymentMethod.Bankily)).toBe(true);
    expect(provider.handlesMethod(PaymentMethod.Masrvi)).toBe(true);
    expect(provider.handlesMethod(PaymentMethod.Cash)).toBe(false);
  });

  it('derives a deterministic provider reference', async () => {
    const initiation = await provider.initiate({
      method: PaymentMethod.Bankily,
      internalReference: 'PAY-1',
      amount: '10.00',
      currency: 'MRU',
    });
    expect(initiation.providerReference).toBe('test_PAY-1');
  });

  it('verifies a correctly signed webhook and normalizes the event', () => {
    const body = event();
    const parsed = provider.verifyAndParse({
      rawBody: body,
      headers: { [TEST_SIGNATURE_HEADER]: provider.sign(body) },
    });
    expect(parsed.outcome).toBe(ProviderEventOutcome.Succeeded);
    expect(parsed.internalReference).toBe('PAY-20260722-ABCDEF');
    expect(parsed.amount).toBe('1000.00');
  });

  it('rejects a missing or wrong signature without parsing', () => {
    const body = event();
    expect(() => provider.verifyAndParse({ rawBody: body, headers: {} })).toThrow(
      WebhookSignatureInvalidError,
    );
    expect(() =>
      provider.verifyAndParse({ rawBody: body, headers: { [TEST_SIGNATURE_HEADER]: 'deadbeef' } }),
    ).toThrow(WebhookSignatureInvalidError);
  });

  it('rejects a tampered body whose signature no longer matches', () => {
    const original = event();
    const signature = provider.sign(original);
    const tampered = event({ amount: '999999.00' });
    expect(() =>
      provider.verifyAndParse({ rawBody: tampered, headers: { [TEST_SIGNATURE_HEADER]: signature } }),
    ).toThrow(WebhookSignatureInvalidError);
  });

  it('rejects a signed but structurally invalid payload', () => {
    const body = Buffer.from(JSON.stringify({ eventId: 'x' }));
    expect(() =>
      provider.verifyAndParse({ rawBody: body, headers: { [TEST_SIGNATURE_HEADER]: provider.sign(body) } }),
    ).toThrow(WebhookSignatureInvalidError);
  });
});
