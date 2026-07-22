import { ApiProperty } from '@nestjs/swagger';
import type { Route } from '../route.types';

/** A route as returned by the route endpoints. */
export class RouteResponseDto {
  @ApiProperty({ description: 'Route id.' })
  id!: string;

  @ApiProperty({ description: 'Company id the route belongs to.' })
  companyId!: string;

  @ApiProperty({ description: 'Origin station id.' })
  originStationId!: string;

  @ApiProperty({ description: 'Destination station id.' })
  destinationStationId!: string;

  @ApiProperty({ description: 'Current default price in MRU.' })
  defaultPriceMru!: number;

  @ApiProperty({ description: '3-letter currency code.' })
  currency!: string;

  @ApiProperty({ description: 'Estimated duration in minutes.' })
  estimatedDurationMinutes!: number;

  @ApiProperty({ description: 'Distance in km.' })
  distanceKm!: number;

  @ApiProperty({ description: 'Whether the route is active.' })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  static from(route: Route): RouteResponseDto {
    return {
      id: route.id,
      companyId: route.companyId,
      originStationId: route.originStationId,
      destinationStationId: route.destinationStationId,
      defaultPriceMru: route.defaultPriceMru,
      currency: route.currency,
      estimatedDurationMinutes: route.estimatedDurationMinutes,
      distanceKm: route.distanceKm,
      isActive: route.isActive,
      createdAt: route.createdAt.toISOString(),
      updatedAt: route.updatedAt.toISOString(),
    };
  }
}
