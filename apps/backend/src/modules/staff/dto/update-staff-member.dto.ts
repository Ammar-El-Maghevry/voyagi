import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { StaffType } from '../staff-type';
import type { StaffMemberUpdate } from '../staff.types';

const PHONE_PATTERN = /^\+?[0-9]{8,20}$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Request body for `PATCH /companies/:companyId/staff-members/:staffMemberId`.
 * Every field is optional; the service rejects an empty update. `isActive` is
 * excluded — activation is a dedicated transition. A `phone` of `null` clears
 * the stored number.
 */
export class UpdateStaffMemberDto {
  @ApiPropertyOptional({ description: 'Staff member full name.', minLength: 1, maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  fullName?: string;

  @ApiPropertyOptional({ enum: StaffType, description: 'Operational role of the staff member.' })
  @IsOptional()
  @IsEnum(StaffType)
  staffType?: StaffType;

  @ApiPropertyOptional({
    description: 'Contact phone (optional `+` then 8–20 digits), or null to clear it.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'phone must be an optional + followed by 8 to 20 digits.',
  })
  phone?: string | null;

  toDomain(): StaffMemberUpdate {
    return {
      fullName: this.fullName,
      staffType: this.staffType,
      phone: this.phone,
    };
  }
}
