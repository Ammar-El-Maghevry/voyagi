import { ApiProperty } from '@nestjs/swagger';

/** Safe subset of the verified principal returned by `GET /auth/me`. */
export class PrincipalResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Verified Supabase auth user id (token subject).',
  })
  userId!: string;

  @ApiProperty({ required: false, description: 'Email claim, when present.' })
  email?: string;

  @ApiProperty({
    required: false,
    description:
      "Token 'role' claim (identity/token type) — not an authorization role.",
  })
  role?: string;

  @ApiProperty({
    required: false,
    description: 'Token expiry as epoch seconds, when present.',
  })
  expiresAt?: number;
}
