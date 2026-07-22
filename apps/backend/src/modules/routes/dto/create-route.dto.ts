import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import type { RouteCreate } from '../route.types';

/** Positive `bigint` surrogate key as a string (no leading zeros). */
const BIGINT_PATTERN = /^[1-9][0-9]*$/;
/** ISO-4217-style 3-letter uppercase currency code. */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * Request body for `POST /companies/:companyId/routes`. `companyId` comes from
 * the tenant path. Stations reference the global catalog (validated as active).
 * `defaultPriceMru` seeds both the route and its initial price-history period.
 */
export class CreateRouteDto {
  @ApiProperty({ description: 'Origin station id (global catalog).' })
  @IsString()
  @Matches(BIGINT_PATTERN, { message: 'originStationId must be a positive integer id.' })
  originStationId!: string;

  @ApiProperty({ description: 'Destination station id (must differ from origin).' })
  @IsString()
  @Matches(BIGINT_PATTERN, { message: 'destinationStationId must be a positive integer id.' })
  destinationStationId!: string;

  @ApiProperty({ description: 'Default price in MRU (non-negative).', minimum: 0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultPriceMru!: number;

  @ApiPropertyOptional({ description: '3-letter currency code.', default: 'MRU' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Matches(CURRENCY_PATTERN, { message: 'currency must be a 3-letter code.' })
  currency?: string;

  @ApiProperty({ description: 'Estimated duration in minutes (positive).', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  estimatedDurationMinutes!: number;

  @ApiPropertyOptional({ description: 'Distance in km (non-negative).', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  distanceKm?: number;

  toDomain(): RouteCreate {
    return {
      originStationId: this.originStationId,
      destinationStationId: this.destinationStationId,
      defaultPriceMru: this.defaultPriceMru,
      currency: this.currency ?? 'MRU',
      estimatedDurationMinutes: this.estimatedDurationMinutes,
      distanceKm: this.distanceKm,
    };
  }
}
