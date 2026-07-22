import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import type {
  CommissionAccessScope,
  CommissionMembership,
  CommissionPage,
  CommissionTransaction,
} from './commission.types';

export const COMMISSIONS_REPOSITORY = Symbol('COMMISSIONS_REPOSITORY');

export interface CommissionsRepository {
  findActorMemberships(
    executor: DatabaseExecutor,
    actorUserId: string,
    companyId: string,
  ): Promise<CommissionMembership[]>;
  listForCompany(
    executor: DatabaseExecutor,
    companyId: string,
    scope: CommissionAccessScope,
    pagination: ResolvedPagination,
  ): Promise<CommissionPage>;
  createEligible(
    executor: DatabaseExecutor,
    bookingId: string,
    companyId: string,
  ): Promise<CommissionTransaction | null>;
  applyBookingCancellation(
    executor: DatabaseExecutor,
    bookingId: string,
    companyId: string,
  ): Promise<CommissionTransaction | null>;
  applyFullRefund(
    executor: DatabaseExecutor,
    bookingId: string,
    companyId: string,
  ): Promise<CommissionTransaction | null>;
}
