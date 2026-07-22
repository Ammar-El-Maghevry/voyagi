import { ApiProperty } from '@nestjs/swagger';
import { MembershipRole } from '../membership-role';
import type { MembershipView } from '../identity.types';

/** A membership as returned by the company membership listing/read endpoints. */
export class MembershipResponseDto {
  @ApiProperty({ description: 'Membership id.' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Member auth user id.' })
  userId!: string;

  @ApiProperty({ description: 'Member display name.' })
  memberName!: string;

  @ApiProperty({ description: 'Company id the membership belongs to.' })
  companyId!: string;

  @ApiProperty({ enum: MembershipRole, description: 'Role within the company.' })
  role!: MembershipRole;

  @ApiProperty({ required: false, description: 'Branch the membership is scoped to, when any.' })
  branchId?: string;

  @ApiProperty({ description: 'Whether the membership is active.' })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  static from(view: MembershipView): MembershipResponseDto {
    return {
      id: view.id,
      userId: view.userId,
      memberName: view.memberName,
      companyId: view.companyId,
      role: view.role,
      branchId: view.branchId,
      isActive: view.isActive,
      createdAt: view.createdAt.toISOString(),
      updatedAt: view.updatedAt.toISOString(),
    };
  }
}
