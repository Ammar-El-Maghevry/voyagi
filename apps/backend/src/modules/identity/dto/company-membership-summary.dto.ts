import { ApiProperty } from '@nestjs/swagger';
import { MembershipRole } from '../membership-role';
import type { MembershipView } from '../identity.types';

/** One entry of "the companies I belong to" (`GET /profiles/me/companies`). */
export class CompanyMembershipSummaryDto {
  @ApiProperty({ description: 'Company id.' })
  companyId!: string;

  @ApiProperty({ description: 'Company name.' })
  companyName!: string;

  @ApiProperty({ description: "Caller's membership id in this company." })
  membershipId!: string;

  @ApiProperty({ enum: MembershipRole, description: "Caller's role in this company." })
  role!: MembershipRole;

  @ApiProperty({ required: false, description: 'Branch the membership is scoped to, when any.' })
  branchId?: string;

  @ApiProperty({ description: 'Whether the membership is active.' })
  isActive!: boolean;

  static from(view: MembershipView): CompanyMembershipSummaryDto {
    return {
      companyId: view.companyId,
      companyName: view.companyName,
      membershipId: view.id,
      role: view.role,
      branchId: view.branchId,
      isActive: view.isActive,
    };
  }
}
