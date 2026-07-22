import type { MembershipRole } from '../identity/membership-role';
import type { CommissionStatus } from './commission-status';

export interface CommissionTransaction {
  readonly id: string;
  readonly agentMembershipId: string;
  readonly bookingId: string;
  readonly companyId: string;
  readonly commissionRate: string;
  readonly baseAmount: string;
  readonly commissionAmount: string;
  readonly currency: string;
  readonly status: CommissionStatus;
  readonly earnedAt?: Date;
  readonly paidAt?: Date;
  readonly cancelledAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CommissionPage {
  readonly items: readonly CommissionTransaction[];
  readonly total: number;
}

export interface CommissionMembership {
  readonly id: string;
  readonly role: MembershipRole;
}

export interface CommissionAccessScope {
  readonly companyWide: boolean;
  readonly agentMembershipIds: readonly string[];
}
