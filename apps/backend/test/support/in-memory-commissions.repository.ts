import type { ResolvedPagination } from '../../src/common/pagination/pagination';
import type { DatabaseExecutor } from '../../src/infrastructure/database/database.types';
import type {
  CommissionAccessScope,
  CommissionMembership,
  CommissionPage,
  CommissionTransaction,
} from '../../src/modules/commissions/commission.types';
import type { CommissionsRepository } from '../../src/modules/commissions/commissions.repository';

/** In-memory commissions store preserving actor and company filters. */
export class InMemoryCommissionsRepository implements CommissionsRepository {
  private readonly memberships = new Map<string, CommissionMembership[]>();
  private readonly transactions: CommissionTransaction[] = [];

  addMembership(userId: string, membership: CommissionMembership): void {
    this.memberships.set(userId, [...(this.memberships.get(userId) ?? []), membership]);
  }

  addTransaction(transaction: CommissionTransaction): void {
    this.transactions.push(transaction);
  }

  findActorMemberships(
    _executor: DatabaseExecutor,
    actorUserId: string,
    _companyId: string,
  ): Promise<CommissionMembership[]> {
    return Promise.resolve(this.memberships.get(actorUserId) ?? []);
  }

  listForCompany(
    _executor: DatabaseExecutor,
    companyId: string,
    scope: CommissionAccessScope,
    pagination: ResolvedPagination,
  ): Promise<CommissionPage> {
    const all = this.transactions.filter(
      (transaction) =>
        transaction.companyId === companyId &&
        (scope.companyWide ||
          scope.agentMembershipIds.includes(transaction.agentMembershipId)),
    );
    return Promise.resolve({
      items: all.slice(pagination.offset, pagination.offset + pagination.limit),
      total: all.length,
    });
  }

  createEligible(): Promise<CommissionTransaction | null> {
    return Promise.resolve(null);
  }

  applyBookingCancellation(): Promise<CommissionTransaction | null> {
    return Promise.resolve(null);
  }

  applyFullRefund(): Promise<CommissionTransaction | null> {
    return Promise.resolve(null);
  }
}
