import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import type { ProfileUpdate } from '../identity.types';

/** International phone form accepted by the database (`ck_profiles_phone`). */
const PHONE_PATTERN = /^\+?[0-9]{8,20}$/;

/**
 * Request body for `PATCH /profiles/me`. Only the two fields a user may edit on
 * their own profile are accepted (the RLS grant is `full_name`, `phone_number`);
 * any other property is rejected by the global whitelist validation. At least
 * one field must be present — enforced by the service.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'New display name.', minLength: 1, maxLength: 200 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 200)
  fullName?: string;

  @ApiPropertyOptional({
    description: 'New contact phone (optional `+` then 8–20 digits), or null to clear it.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'phoneNumber must be an optional + followed by 8 to 20 digits.',
  })
  phoneNumber?: string | null;

  toDomain(): ProfileUpdate {
    return { fullName: this.fullName, phoneNumber: this.phoneNumber };
  }
}
