import { parseCommissionStatus } from './commission-status';
import type { CommissionTransaction } from './commission.types';

export interface CommissionRow {
  id: string;
  agent_membership_id: string;
  booking_id: string;
  company_id: string;
  commission_rate: string;
  base_amount: string;
  commission_amount: string;
  currency: string;
  status: string;
  earned_at: Date | null;
  paid_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function mapCommission(row: CommissionRow): CommissionTransaction {
  return {
    id: row.id,
    agentMembershipId: row.agent_membership_id,
    bookingId: row.booking_id,
    companyId: row.company_id,
    commissionRate: row.commission_rate,
    baseAmount: row.base_amount,
    commissionAmount: row.commission_amount,
    currency: row.currency,
    status: parseCommissionStatus(row.status),
    earnedAt: row.earned_at ?? undefined,
    paidAt: row.paid_at ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
