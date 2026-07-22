import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, Matches } from 'class-validator';
import type { TripCreate } from '../trip.types';

/** Positive `bigint` surrogate key as a string (no leading zeros). */
const BIGINT_PATTERN = /^[1-9][0-9]*$/;

/**
 * Request body for `POST /companies/:companyId/trips`. `companyId` comes from the
 * tenant path. Price, currency, boarding-close time and status are all derived
 * server-side (never from the body). The route/bus must belong to the company.
 */
export class CreateTripDto {
  @ApiProperty({ description: 'Route id within the company.' })
  @IsString()
  @Matches(BIGINT_PATTERN, { message: 'routeId must be a positive integer id.' })
  routeId!: string;

  @ApiProperty({ description: 'Bus id within the company.' })
  @IsString()
  @Matches(BIGINT_PATTERN, { message: 'busId must be a positive integer id.' })
  busId!: string;

  @ApiPropertyOptional({ description: 'Driver staff id (active DRIVER in the company).' })
  @IsOptional()
  @IsString()
  @Matches(BIGINT_PATTERN, { message: 'driverId must be a positive integer id.' })
  driverId?: string;

  @ApiPropertyOptional({ description: 'Assistant staff id (active ASSISTANT in the company).' })
  @IsOptional()
  @IsString()
  @Matches(BIGINT_PATTERN, { message: 'assistantId must be a positive integer id.' })
  assistantId?: string;

  @ApiProperty({ format: 'date-time', description: 'Scheduled departure (ISO-8601).' })
  @Type(() => Date)
  @IsDate()
  departureTime!: Date;

  @ApiProperty({ format: 'date-time', description: 'Scheduled arrival (must be after departure).' })
  @Type(() => Date)
  @IsDate()
  estimatedArrivalTime!: Date;

  toDomain(): TripCreate {
    return {
      routeId: this.routeId,
      busId: this.busId,
      driverId: this.driverId,
      assistantId: this.assistantId,
      departureTime: this.departureTime,
      estimatedArrivalTime: this.estimatedArrivalTime,
    };
  }
}
