/** Lifecycle states for an immutable agent commission transaction. */
export enum CommissionStatus {
  Pending = 'PENDING',
  Earned = 'EARNED',
  Paid = 'PAID',
  Cancelled = 'CANCELLED',
}

export function parseCommissionStatus(value: string): CommissionStatus {
  if ((Object.values(CommissionStatus) as string[]).includes(value)) {
    return value as CommissionStatus;
  }
  throw new Error('database returned an unknown commission status');
}
