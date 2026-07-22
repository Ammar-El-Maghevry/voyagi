import { PaymentStatus } from './payment.types';
import {
  canTransitionPayment,
  isTerminalPaymentStatus,
  PAYMENT_TRANSITIONS,
} from './payment-transitions';

describe('payment transitions', () => {
  it('permits exactly the documented transitions', () => {
    expect(canTransitionPayment(PaymentStatus.Pending, PaymentStatus.Processing)).toBe(true);
    expect(canTransitionPayment(PaymentStatus.Pending, PaymentStatus.Succeeded)).toBe(true);
    expect(canTransitionPayment(PaymentStatus.Pending, PaymentStatus.Cancelled)).toBe(true);
    expect(canTransitionPayment(PaymentStatus.Processing, PaymentStatus.Succeeded)).toBe(true);
    expect(canTransitionPayment(PaymentStatus.Processing, PaymentStatus.Failed)).toBe(true);
    expect(canTransitionPayment(PaymentStatus.Processing, PaymentStatus.Cancelled)).toBe(true);
    expect(canTransitionPayment(PaymentStatus.Succeeded, PaymentStatus.Refunded)).toBe(true);
  });

  it('never authorizes a transition to PARTIALLY_REFUNDED (full-refund-only scope)', () => {
    expect(canTransitionPayment(PaymentStatus.Succeeded, PaymentStatus.PartiallyRefunded)).toBe(false);
    expect(canTransitionPayment(PaymentStatus.PartiallyRefunded, PaymentStatus.Refunded)).toBe(false);
    expect(isTerminalPaymentStatus(PaymentStatus.PartiallyRefunded)).toBe(true);
  });

  it('rejects illegal and backward transitions', () => {
    expect(canTransitionPayment(PaymentStatus.Pending, PaymentStatus.Failed)).toBe(false);
    expect(canTransitionPayment(PaymentStatus.Pending, PaymentStatus.Refunded)).toBe(false);
    expect(canTransitionPayment(PaymentStatus.Processing, PaymentStatus.Processing)).toBe(false);
    expect(canTransitionPayment(PaymentStatus.Succeeded, PaymentStatus.Failed)).toBe(false);
    expect(canTransitionPayment(PaymentStatus.Succeeded, PaymentStatus.Cancelled)).toBe(false);
  });

  it('treats FAILED, CANCELLED and REFUNDED as terminal', () => {
    expect(isTerminalPaymentStatus(PaymentStatus.Failed)).toBe(true);
    expect(isTerminalPaymentStatus(PaymentStatus.Cancelled)).toBe(true);
    expect(isTerminalPaymentStatus(PaymentStatus.Refunded)).toBe(true);
    expect(isTerminalPaymentStatus(PaymentStatus.Succeeded)).toBe(false);
    for (const to of PAYMENT_TRANSITIONS[PaymentStatus.Failed]) {
      throw new Error(`FAILED should have no transitions, found ${to}`);
    }
  });

  it('covers every status as a matrix key', () => {
    for (const status of Object.values(PaymentStatus)) {
      expect(PAYMENT_TRANSITIONS[status]).toBeDefined();
    }
  });
});
