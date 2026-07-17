import { ApiProperty } from '@nestjs/swagger';

/** Swagger DTO describing the liveness payload (inside the success envelope). */
export class LivenessResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: string;
}

/** Swagger DTO describing the readiness payload (inside the success envelope). */
export class ReadinessResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: string;

  @ApiProperty({
    description: 'Per-dependency readiness results.',
    example: {},
    additionalProperties: { type: 'string', example: 'up' },
  })
  checks!: Record<string, string>;
}
