import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { StaffType } from '../staff-type';
import type { StaffMemberCreate } from '../staff.types';

const PHONE_PATTERN = /^\+?[0-9]{8,20}$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Request body for `POST /companies/:companyId/staff-members`. `companyId` is
 * taken from the tenant path, never the body.
 */
export class CreateStaffMemberDto {
  @ApiProperty({ description: 'Staff member full name.', minLength: 1, maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  fullName!: string;

  @ApiProperty({ enum: StaffType, description: 'Operational role of the staff member.' })
  @IsEnum(StaffType)
  staffType!: StaffType;

  @ApiPropertyOptional({ description: 'Contact phone (optional `+` then 8–20 digits).' })
  @IsOptional()
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'phone must be an optional + followed by 8 to 20 digits.',
  })
  phone?: string;

  toDomain(): StaffMemberCreate {
    return {
      fullName: this.fullName,
      staffType: this.staffType,
      phone: this.phone,
    };
  }
}
