import { CommissionStatus } from './commission-status';
import { canTransitionCommission } from './commission-transitions';

describe('commission transitions', () => {
  it('permits only the lifecycle transitions enforced by the database', () => {
    expect(canTransitionCommission(CommissionStatus.Pending, CommissionStatus.Earned)).toBe(true);
    expect(canTransitionCommission(CommissionStatus.Pending, CommissionStatus.Cancelled)).toBe(true);
    expect(canTransitionCommission(CommissionStatus.Earned, CommissionStatus.Paid)).toBe(true);
    expect(canTransitionCommission(CommissionStatus.Earned, CommissionStatus.Cancelled)).toBe(true);
    expect(canTransitionCommission(CommissionStatus.Paid, CommissionStatus.Cancelled)).toBe(false);
    expect(canTransitionCommission(CommissionStatus.Cancelled, CommissionStatus.Earned)).toBe(false);
  });
});
