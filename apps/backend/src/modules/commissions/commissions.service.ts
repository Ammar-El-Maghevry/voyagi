import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { DatabaseService } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { isUuid, parsePositiveBigInt } from '../identity/identifier.util';
import { MembershipRole } from '../identity/membership-role';
import {
  COMMISSIONS_REPOSITORY,
  type CommissionsRepository,
} from './commissions.repository';
import type { CommissionPage, CommissionTransaction } from './commission.types';

const EMPTY_PAGE: CommissionPage = { items: [], total: 0 };

@Injectable()
export class CommissionsService {
  constructor(
    @Inject(COMMISSIONS_REPOSITORY) private readonly repository: CommissionsRepository,
    private readonly db: DatabaseService,
  ) {}

  async listTransactions(
    actorUserId: string,
    companyId: string | undefined,
    pagination: ResolvedPagination,
  ): Promise<CommissionPage> {
    const company = parsePositiveBigInt(companyId ?? '');
    if (!company || !isUuid(actorUserId)) return EMPTY_PAGE;

    const memberships = await this.repository.findActorMemberships(this.db, actorUserId, company);
    const companyWide = memberships.some(
      ({ role }) => role === MembershipRole.CompanyManager || role === MembershipRole.SuperAdmin,
    );
    const agentMembershipIds = memberships
      .filter(({ role }) => role === MembershipRole.Agent)
      .map(({ id }) => id);
    if (!companyWide && agentMembershipIds.length === 0) return EMPTY_PAGE;

    // Managers see their tenant; agents are restricted to commissions for their
    // own currently active AGENT memberships, independent of branch access.
    return this.repository.listForCompany(this.db, company, { companyWide, agentMembershipIds }, pagination);
  }

  createEligible(
    executor: DatabaseExecutor,
    bookingId: string,
    companyId: string,
  ): Promise<CommissionTransaction | null> {
    return this.repository.createEligible(executor, bookingId, companyId);
  }

  applyBookingCancellation(
    executor: DatabaseExecutor,
    bookingId: string,
    companyId: string,
  ): Promise<CommissionTransaction | null> {
    return this.repository.applyBookingCancellation(executor, bookingId, companyId);
  }

  applyFullRefund(
    executor: DatabaseExecutor,
    bookingId: string,
    companyId: string,
  ): Promise<CommissionTransaction | null> {
    return this.repository.applyFullRefund(executor, bookingId, companyId);
  }
}
