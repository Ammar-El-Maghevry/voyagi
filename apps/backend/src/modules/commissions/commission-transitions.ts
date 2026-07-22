import { CommissionStatus } from './commission-status';

/** The lifecycle allowed by the database transition trigger. */
export const COMMISSION_TRANSITIONS: Readonly<
  Record<CommissionStatus, readonly CommissionStatus[]>
> = Object.freeze({
  [CommissionStatus.Pending]: [CommissionStatus.Earned, CommissionStatus.Cancelled],
  [CommissionStatus.Earned]: [CommissionStatus.Paid, CommissionStatus.Cancelled],
  [CommissionStatus.Paid]: [],
  [CommissionStatus.Cancelled]: [],
});

export function canTransitionCommission(from: CommissionStatus, to: CommissionStatus): boolean {
  return COMMISSION_TRANSITIONS[from].includes(to);
}
