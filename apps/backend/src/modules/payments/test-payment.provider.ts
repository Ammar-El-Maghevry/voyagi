import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookSignatureInvalidError } from './payment.errors';
import {
  type PaymentProvider,
  type ProviderEvent,
  ProviderEventOutcome,
  type ProviderInitiation,
  type ProviderInitiationRequest,
  type WebhookRequest,
} from './payment-provider.port';
import { isOnlineMethod, type PaymentMethod } from './payment.types';

/** Header carrying the HMAC-SHA256 signature of the raw webhook body. */
export const TEST_SIGNATURE_HEADER = 'x-voyagi-signature';

/**
 * Deterministic, in-process payment provider used for tests and local
 * development. It is NOT a real integration: it invents no vendor behavior and
 * stores no real secret. The shared HMAC secret is a test fixture supplied by
 * configuration, never a production provider credential — real Bankily / Masrvi
 * / Seddad adapters are deferred until their contracts are documented.
 *
 * Signature scheme (test-only): `HMAC_SHA256(secret, rawBody)` hex, sent in the
 * `x-voyagi-signature` header and verified in constant time before the body is
 * trusted.
 */
export class TestPaymentProvider implements PaymentProvider {
  readonly name = 'test';

  constructor(private readonly secret: string) {}

  handlesMethod(method: PaymentMethod): boolean {
    return isOnlineMethod(method);
  }

  initiate(request: ProviderInitiationRequest): Promise<ProviderInitiation> {
    // Deterministic provider reference derived from the internal reference — no
    // network call, so it is safe to await inside or outside a transaction.
    return Promise.resolve({
      providerReference: `test_${request.internalReference}`,
    });
  }

  /** Sign a raw body the way a genuine provider webhook would (test helper). */
  sign(rawBody: Buffer | string): string {
    return createHmac('sha256', this.secret)
      .update(typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody)
      .digest('hex');
  }

  verifyAndParse(request: WebhookRequest): ProviderEvent {
    const provided = request.headers[TEST_SIGNATURE_HEADER];
    const signature = Array.isArray(provided) ? provided[0] : provided;
    if (!signature || !this.isValidSignature(request.rawBody, signature)) {
      throw new WebhookSignatureInvalidError();
    }

    let payload: unknown;
    try {
      payload = JSON.parse(request.rawBody.toString('utf8'));
    } catch {
      throw new WebhookSignatureInvalidError();
    }
    return this.parse(payload);
  }

  private isValidSignature(rawBody: Buffer, signature: string): boolean {
    const expected = Buffer.from(this.sign(rawBody), 'utf8');
    const actual = Buffer.from(signature, 'utf8');
    // Constant-time comparison; unequal lengths are rejected without leaking.
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private parse(payload: unknown): ProviderEvent {
    if (typeof payload !== 'object' || payload === null) {
      throw new WebhookSignatureInvalidError();
    }
    const body = payload as Record<string, unknown>;
    const outcome =
      body.outcome === ProviderEventOutcome.Succeeded
        ? ProviderEventOutcome.Succeeded
        : body.outcome === ProviderEventOutcome.Failed
          ? ProviderEventOutcome.Failed
          : undefined;
    if (
      typeof body.eventId !== 'string' ||
      typeof body.internalReference !== 'string' ||
      typeof body.providerReference !== 'string' ||
      typeof body.amount !== 'string' ||
      typeof body.currency !== 'string' ||
      outcome === undefined
    ) {
      throw new WebhookSignatureInvalidError();
    }
    return {
      eventId: body.eventId,
      providerReference: body.providerReference,
      internalReference: body.internalReference,
      outcome,
      amount: body.amount,
      currency: body.currency,
    };
  }
}
