import { PaymentStatus } from './payment.types';

/**
 * The payment state machine as implemented for Phase 12
 * (`architecture/09-payment-state-machine.md`), mirrored in the database by the
 * `enforce_payment_transition` trigger (migration 016). This is the single
 * source of truth the service consults before every status-changing update so
 * an illegal transition is rejected in the application (as a `409`) before it
 * ever reaches the row.
 *
 * Refund scope is FULL refund only (`SUCCEEDED → REFUNDED`). `PARTIALLY_REFUNDED`
 * remains a valid enum value for future compatibility but is intentionally NOT a
 * reachable target here: the schema has no `refunded_amount` model, so partial
 * refunds are deferred and no Phase 12 path may authorize a transition to it.
 */
export const PAYMENT_TRANSITIONS: Readonly<
  Record<PaymentStatus, readonly PaymentStatus[]>
> = Object.freeze({
  [PaymentStatus.Pending]: Object.freeze([
    PaymentStatus.Processing,
    PaymentStatus.Succeeded,
    PaymentStatus.Cancelled,
  ]),
  [PaymentStatus.Processing]: Object.freeze([
    PaymentStatus.Succeeded,
    PaymentStatus.Failed,
    PaymentStatus.Cancelled,
  ]),
  [PaymentStatus.Succeeded]: Object.freeze([PaymentStatus.Refunded]),
  // Terminal (and PARTIALLY_REFUNDED is deferred / never entered in Phase 12).
  [PaymentStatus.PartiallyRefunded]: Object.freeze([]),
  [PaymentStatus.Failed]: Object.freeze([]),
  [PaymentStatus.Cancelled]: Object.freeze([]),
  [PaymentStatus.Refunded]: Object.freeze([]),
});

/** Whether `from → to` is a legal payment transition (identity is not a transition). */
export function canTransitionPayment(
  from: PaymentStatus,
  to: PaymentStatus,
): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/** Whether a status is terminal (no outgoing transitions). */
export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[status].length === 0;
}
