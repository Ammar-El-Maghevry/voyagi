import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import type { BusCreate } from '../bus.types';

/** Positive `bigint` surrogate key as a string (no leading zeros). */
const BIGINT_PATTERN = /^[1-9][0-9]*$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Request body for `POST /companies/:companyId/buses`. `companyId` is taken from
 * the tenant path, never the body. The seat layout must reference an existing
 * global layout (enforced by the database foreign key). `status`, `isActive`
 * and `version` are not client-settable — they take their database defaults.
 */
export class CreateBusDto {
  @ApiProperty({ description: 'Seat layout id the bus uses (global template).' })
  @IsString()
  @Matches(BIGINT_PATTERN, {
    message: 'seatLayoutId must be a positive integer id.',
  })
  seatLayoutId!: string;

  @ApiProperty({ description: 'Registration / plate number.', minLength: 1, maxLength: 50 })
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  plateNumber!: string;

  @ApiPropertyOptional({ description: 'Bus model / description.', maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  busModel?: string;

  @ApiPropertyOptional({
    description: 'Current odometer reading in km (non-negative). Defaults to 0.',
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  currentOdometerKm?: number;

  toDomain(): BusCreate {
    return {
      seatLayoutId: this.seatLayoutId,
      plateNumber: this.plateNumber,
      busModel: this.busModel,
      currentOdometerKm: this.currentOdometerKm,
    };
  }
}
