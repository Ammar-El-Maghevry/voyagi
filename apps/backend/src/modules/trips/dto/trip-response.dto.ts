import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TripStatus } from '../trip-status';
import type { Trip } from '../trip.types';

/** A trip as returned by the trip endpoints. */
export class TripResponseDto {
  @ApiProperty({ description: 'Trip id.' })
  id!: string;

  @ApiProperty({ description: 'Company id the trip belongs to.' })
  companyId!: string;

  @ApiProperty({ description: 'Route id.' })
  routeId!: string;

  @ApiProperty({ description: 'Bus id.' })
  busId!: string;

  @ApiPropertyOptional({ description: 'Driver staff id, when assigned.' })
  driverId?: string;

  @ApiPropertyOptional({ description: 'Assistant staff id, when assigned.' })
  assistantId?: string;

  @ApiProperty({ format: 'date-time' })
  departureTime!: string;

  @ApiProperty({ format: 'date-time' })
  estimatedArrivalTime!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  actualDepartureTime!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  actualArrivalTime!: string | null;

  @ApiProperty({ format: 'date-time', description: 'Server-computed boarding-close time.' })
  boardingClosesAt!: string;

  @ApiProperty({ description: 'Price snapshot in MRU.' })
  priceMru!: number;

  @ApiProperty({ description: '3-letter currency code.' })
  currency!: string;

  @ApiProperty({ enum: TripStatus, description: 'Lifecycle status.' })
  status!: TripStatus;

  @ApiProperty({ description: 'Whether the trip is active.' })
  isActive!: boolean;

  @ApiProperty({ description: 'Optimistic-concurrency version.' })
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  static from(trip: Trip): TripResponseDto {
    return {
      id: trip.id,
      companyId: trip.companyId,
      routeId: trip.routeId,
      busId: trip.busId,
      driverId: trip.driverId,
      assistantId: trip.assistantId,
      departureTime: trip.departureTime.toISOString(),
      estimatedArrivalTime: trip.estimatedArrivalTime.toISOString(),
      actualDepartureTime: trip.actualDepartureTime
        ? trip.actualDepartureTime.toISOString()
        : null,
      actualArrivalTime: trip.actualArrivalTime
        ? trip.actualArrivalTime.toISOString()
        : null,
      boardingClosesAt: trip.boardingClosesAt.toISOString(),
      priceMru: trip.priceMru,
      currency: trip.currency,
      status: trip.status,
      isActive: trip.isActive,
      version: trip.version,
      createdAt: trip.createdAt.toISOString(),
      updatedAt: trip.updatedAt.toISOString(),
    };
  }
}
