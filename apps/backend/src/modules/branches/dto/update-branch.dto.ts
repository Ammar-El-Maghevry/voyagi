import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator';
import type { BranchUpdate } from '../branch.types';

const BIGINT_PATTERN = /^[1-9][0-9]*$/;
const PHONE_PATTERN = /^\+?[0-9]{8,20}$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Request body for `PATCH /companies/:companyId/branches/:branchId`. Every field
 * is optional; the service rejects an empty update. `isActive` is intentionally
 * absent — activation is a dedicated transition, never a generic PATCH field.
 * A `phone` of `null` clears the stored number.
 */
export class UpdateBranchDto {
  @ApiPropertyOptional({ description: 'City id the branch is located in.' })
  @IsOptional()
  @IsString()
  @Matches(BIGINT_PATTERN, { message: 'cityId must be a positive integer id.' })
  cityId?: string;

  @ApiPropertyOptional({ description: 'Branch name (Arabic).', minLength: 1, maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  nameAr?: string;

  @ApiPropertyOptional({ description: 'Branch name (French).', minLength: 1, maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  nameFr?: string;

  @ApiPropertyOptional({
    description: 'Contact phone (optional `+` then 8–20 digits), or null to clear it.',
    nullable: true,
  })
  @IsOptional()
  // Allow explicit null (clears the number); otherwise validate the phone shape.
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'phone must be an optional + followed by 8 to 20 digits.',
  })
  phone?: string | null;

  toDomain(): BranchUpdate {
    return {
      cityId: this.cityId,
      nameAr: this.nameAr,
      nameFr: this.nameFr,
      phone: this.phone,
    };
  }
}
