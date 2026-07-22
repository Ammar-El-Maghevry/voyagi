import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import type { BranchCreate } from '../branch.types';

/** Positive `bigint` surrogate key as a string (no leading zeros). */
const BIGINT_PATTERN = /^[1-9][0-9]*$/;
/** Optional `+` then 8–20 digits (mirrors the profile phone shape). */
const PHONE_PATTERN = /^\+?[0-9]{8,20}$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Request body for `POST /companies/:companyId/branches`. `companyId` is taken
 * from the tenant path, never the body. The city must reference an existing
 * city (enforced by the database foreign key).
 */
export class CreateBranchDto {
  @ApiProperty({ description: 'City id the branch is located in.' })
  @IsString()
  @Matches(BIGINT_PATTERN, { message: 'cityId must be a positive integer id.' })
  cityId!: string;

  @ApiProperty({ description: 'Branch name (Arabic).', minLength: 1, maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  nameAr!: string;

  @ApiProperty({ description: 'Branch name (French).', minLength: 1, maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  nameFr!: string;

  @ApiPropertyOptional({ description: 'Contact phone (optional `+` then 8–20 digits).' })
  @IsOptional()
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'phone must be an optional + followed by 8 to 20 digits.',
  })
  phone?: string;

  toDomain(): BranchCreate {
    return {
      cityId: this.cityId,
      nameAr: this.nameAr,
      nameFr: this.nameFr,
      phone: this.phone,
    };
  }
}
