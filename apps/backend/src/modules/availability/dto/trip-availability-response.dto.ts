import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OccupantGender,
  SeatAvailabilityStatus,
  type PublicTripAvailability,
} from '../availability.types';

export class PublicSeatAvailabilityDto {
  @ApiProperty({ description: 'Canonical seat id from the trip bus layout.' })
  seatId!: string;

  @ApiProperty({ description: 'Display label from the trip bus layout.' })
  label!: string;

  @ApiProperty({ enum: SeatAvailabilityStatus })
  status!: SeatAvailabilityStatus;

  @ApiPropertyOptional({
    enum: OccupantGender,
    nullable: true,
    description: 'Null for available seats; no passenger identity is exposed.',
  })
  occupantGender!: OccupantGender | null;
}

export class TripAvailabilityResponseDto {
  @ApiProperty()
  tripId!: string;

  @ApiProperty({ minimum: 0 })
  totalSeatCount!: number;

  @ApiProperty({ minimum: 0 })
  availableSeatCount!: number;

  @ApiProperty({ type: PublicSeatAvailabilityDto, isArray: true })
  seats!: PublicSeatAvailabilityDto[];

  static from(
    availability: PublicTripAvailability,
  ): TripAvailabilityResponseDto {
    return {
      tripId: availability.tripId,
      totalSeatCount: availability.totalSeatCount,
      availableSeatCount: availability.availableSeatCount,
      seats: availability.seats.map((seat) => ({
        seatId: seat.seatId,
        label: seat.label,
        status: seat.status,
        occupantGender: seat.occupantGender,
      })),
    };
  }
}
