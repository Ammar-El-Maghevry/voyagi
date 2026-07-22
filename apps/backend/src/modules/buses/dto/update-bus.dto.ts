import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import type { BusUpdate } from '../bus.types';

/** Positive `bigint` surrogate key as a string (no leading zeros). */
const BIGINT_PATTERN = /^[1-9][0-9]*$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Request body for `PATCH /companies/:companyId/buses/:busId`. Every field is
 * optional; the service rejects an empty update. `status` and `isActive` are
 * excluded — status is maintenance-driven (deferred) and activation is a
 * dedicated transition. A `busModel` of `null` clears the stored model. Only a
 * non-negative `currentOdometerKm` is accepted (no monotonic rule is
 * documented).
 */
export class UpdateBusDto {
  @ApiPropertyOptional({ description: 'Seat layout id the bus uses (global template).' })
  @IsOptional()
  @IsString()
  @Matches(BIGINT_PATTERN, {
    message: 'seatLayoutId must be a positive integer id.',
  })
  seatLayoutId?: string;

  @ApiPropertyOptional({ description: 'Registration / plate number.', minLength: 1, maxLength: 50 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  plateNumber?: string;

  @ApiPropertyOptional({
    description: 'Bus model / description, or null to clear it.',
    maxLength: 100,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  busModel?: string | null;

  @ApiPropertyOptional({
    description: 'Current odometer reading in km (non-negative).',
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  currentOdometerKm?: number;

  toDomain(): BusUpdate {
    return {
      seatLayoutId: this.seatLayoutId,
      plateNumber: this.plateNumber,
      busModel: this.busModel,
      currentOdometerKm: this.currentOdometerKm,
    };
  }
}
