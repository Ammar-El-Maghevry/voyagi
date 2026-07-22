import type { PaymentMethod } from './payment.types';

/** Injection token for the set of registered payment-provider adapters. */
export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');

/** Normalized outcome a provider event maps to (never a raw provider status). */
export enum ProviderEventOutcome {
  Succeeded = 'SUCCEEDED',
  Failed = 'FAILED',
}

/** Server-derived request to open a settlement with a provider. */
export interface ProviderInitiationRequest {
  readonly method: PaymentMethod;
  readonly internalReference: string;
  readonly amount: string;
  readonly currency: string;
}

/** Normalized result of opening a provider settlement. */
export interface ProviderInitiation {
  /** The provider-side settlement id, stored as `payments.provider_reference`. */
  readonly providerReference: string;
}

/**
 * A verified, normalized provider event. The application never sees raw provider
 * payloads beyond this boundary: only these internal concepts cross into the
 * domain, so provider details cannot leak into services, events or logs.
 */
export interface ProviderEvent {
  /** Stable provider event id (for dedup / correlation). */
  readonly eventId: string;
  readonly providerReference: string;
  readonly internalReference: string;
  readonly outcome: ProviderEventOutcome;
  readonly amount: string;
  readonly currency: string;
}

/** Raw material a webhook hands to the adapter for verification. */
export interface WebhookRequest {
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/**
 * Provider-neutral payment port. Concrete adapters (Bankily / Masrvi / Seddad)
 * are deferred until their signature and payload contracts are documented; only
 * a deterministic test adapter is wired today. Adapters translate raw provider
 * material into normalized internal concepts and MUST verify authenticity before
 * trusting any payload contents.
 */
export interface PaymentProvider {
  /** The provider slug used in `POST /webhooks/payments/{provider}` and method routing. */
  readonly name: string;
  /** Whether this adapter settles the given internal method. */
  handlesMethod(method: PaymentMethod): boolean;
  /** Open a settlement; returns the provider reference to persist. */
  initiate(request: ProviderInitiationRequest): Promise<ProviderInitiation>;
  /**
   * Verify the webhook's authenticity (constant-time signature check, etc.) and
   * parse it into a normalized {@link ProviderEvent}. MUST throw when the
   * signature is invalid — no state may be mutated on an unverified payload.
   */
  verifyAndParse(request: WebhookRequest): ProviderEvent;
}
