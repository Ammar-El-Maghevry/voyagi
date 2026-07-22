import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffType } from '../staff-type';
import type { StaffMember } from '../staff.types';

/** A staff member as returned by the staff endpoints. */
export class StaffMemberResponseDto {
  @ApiProperty({ description: 'Staff member id.' })
  id!: string;

  @ApiProperty({ description: 'Company id the staff member belongs to.' })
  companyId!: string;

  @ApiProperty({ description: 'Full name.' })
  fullName!: string;

  @ApiPropertyOptional({ description: 'Contact phone, when set.' })
  phone?: string;

  @ApiProperty({ enum: StaffType, description: 'Operational role.' })
  staffType!: StaffType;

  @ApiProperty({ description: 'Whether the staff member is active.' })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  static from(staffMember: StaffMember): StaffMemberResponseDto {
    return {
      id: staffMember.id,
      companyId: staffMember.companyId,
      fullName: staffMember.fullName,
      phone: staffMember.phone,
      staffType: staffMember.staffType,
      isActive: staffMember.isActive,
      createdAt: staffMember.createdAt.toISOString(),
      updatedAt: staffMember.updatedAt.toISOString(),
    };
  }
}
