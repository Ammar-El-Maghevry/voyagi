import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PublicTripSearchItem } from '../availability.types';

export class PublicCompanyDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  logoUrl!: string | null;
}

export class PublicStationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  nameAr!: string;

  @ApiProperty()
  nameFr!: string;
}

/** Deliberately narrow public trip projection; no fleet or staff fields. */
export class PublicTripResponseDto {
  @ApiProperty()
  tripId!: string;

  @ApiProperty({ type: PublicCompanyDto })
  company!: PublicCompanyDto;

  @ApiProperty({ type: PublicStationDto })
  originStation!: PublicStationDto;

  @ApiProperty({ type: PublicStationDto })
  destinationStation!: PublicStationDto;

  @ApiProperty({ format: 'date-time' })
  departureTime!: string;

  @ApiProperty({ format: 'date-time' })
  estimatedArrivalTime!: string;

  @ApiProperty({
    type: String,
    example: '500.00',
    description: 'Estimated decimal price.',
  })
  estimatedPrice!: string;

  @ApiProperty({ example: 'MRU' })
  currency!: string;

  @ApiProperty({ minimum: 0 })
  availableSeatCount!: number;

  static from(trip: PublicTripSearchItem): PublicTripResponseDto {
    return {
      tripId: trip.tripId,
      company: {
        id: trip.company.id,
        name: trip.company.name,
        logoUrl: trip.company.logoUrl,
      },
      originStation: {
        id: trip.originStation.id,
        nameAr: trip.originStation.nameAr,
        nameFr: trip.originStation.nameFr,
      },
      destinationStation: {
        id: trip.destinationStation.id,
        nameAr: trip.destinationStation.nameAr,
        nameFr: trip.destinationStation.nameFr,
      },
      departureTime: trip.departureTime.toISOString(),
      estimatedArrivalTime: trip.estimatedArrivalTime.toISOString(),
      estimatedPrice: trip.estimatedPrice,
      currency: trip.currency,
      availableSeatCount: trip.availableSeatCount,
    };
  }
}
