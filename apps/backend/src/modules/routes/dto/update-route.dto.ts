import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import type { RouteUpdate } from '../route.types';

/** Positive `bigint` surrogate key as a string (no leading zeros). */
const BIGINT_PATTERN = /^[1-9][0-9]*$/;

/**
 * Request body for `PATCH /companies/:companyId/routes/:routeId`. Every field is
 * optional; the service rejects an empty update. `isActive` (dedicated
 * transition) and price (append-only pricing flow) are intentionally excluded.
 */
export class UpdateRouteDto {
  @ApiPropertyOptional({ description: 'Origin station id (global catalog).' })
  @IsOptional()
  @IsString()
  @Matches(BIGINT_PATTERN, { message: 'originStationId must be a positive integer id.' })
  originStationId?: string;

  @ApiPropertyOptional({ description: 'Destination station id (must differ from origin).' })
  @IsOptional()
  @IsString()
  @Matches(BIGINT_PATTERN, { message: 'destinationStationId must be a positive integer id.' })
  destinationStationId?: string;

  @ApiPropertyOptional({ description: 'Estimated duration in minutes (positive).', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  estimatedDurationMinutes?: number;

  @ApiPropertyOptional({ description: 'Distance in km (non-negative).', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  distanceKm?: number;

  toDomain(): RouteUpdate {
    return {
      originStationId: this.originStationId,
      destinationStationId: this.destinationStationId,
      estimatedDurationMinutes: this.estimatedDurationMinutes,
      distanceKm: this.distanceKm,
    };
  }
}
