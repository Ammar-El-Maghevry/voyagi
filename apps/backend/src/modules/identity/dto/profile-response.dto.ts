import { ApiProperty } from '@nestjs/swagger';
import type { Profile } from '../identity.types';

/** Public representation of a user's own profile (`GET`/`PATCH /profiles/me`). */
export class ProfileResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Profile id, identical to the Supabase auth user id.',
  })
  id!: string;

  @ApiProperty({ description: 'Display name.' })
  fullName!: string;

  @ApiProperty({ required: false, description: 'Contact phone, when set.' })
  phoneNumber?: string;

  @ApiProperty({ description: 'Whether the account is enabled.' })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  static from(profile: Profile): ProfileResponseDto {
    return {
      id: profile.id,
      fullName: profile.fullName,
      phoneNumber: profile.phoneNumber,
      isActive: profile.isActive,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
