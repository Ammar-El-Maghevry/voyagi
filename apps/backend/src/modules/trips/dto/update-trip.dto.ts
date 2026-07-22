import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import type { TripUpdate } from '../trip.types';

/** Positive `bigint` surrogate key as a string (no leading zeros). */
const BIGINT_PATTERN = /^[1-9][0-9]*$/;

/**
 * Request body for `PATCH /companies/:companyId/trips/:tripId`. Editable only
 * while the trip is `SCHEDULED`. `expectedVersion` is required for optimistic
 * concurrency — a mismatch is a `409`. A `null` driver/assistant clears the
 * assignment. Status and actual times are never edited here.
 */
export class UpdateTripDto {
  @ApiProperty({ description: 'Expected current version (optimistic lock).', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ format: 'date-time', description: 'New scheduled departure.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  departureTime?: Date;

  @ApiPropertyOptional({ format: 'date-time', description: 'New scheduled arrival (after departure).' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  estimatedArrivalTime?: Date;

  @ApiPropertyOptional({ description: 'Driver staff id, or null to clear.', nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @Matches(BIGINT_PATTERN, { message: 'driverId must be a positive integer id.' })
  driverId?: string | null;

  @ApiPropertyOptional({ description: 'Assistant staff id, or null to clear.', nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @Matches(BIGINT_PATTERN, { message: 'assistantId must be a positive integer id.' })
  assistantId?: string | null;

  toDomain(): TripUpdate {
    return {
      departureTime: this.departureTime,
      estimatedArrivalTime: this.estimatedArrivalTime,
      driverId: this.driverId,
      assistantId: this.assistantId,
    };
  }
}
