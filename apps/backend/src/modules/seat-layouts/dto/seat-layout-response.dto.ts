import { ApiProperty } from '@nestjs/swagger';
import type { SeatLayout } from '../seat-layout.types';

/** A seat layout as returned by the seat-layout endpoints. */
export class SeatLayoutResponseDto {
  @ApiProperty({ description: 'Seat layout id.' })
  id!: string;

  @ApiProperty({ description: 'Human-readable layout name.' })
  name!: string;

  @ApiProperty({ description: 'Declared seat count.' })
  totalSeats!: number;

  @ApiProperty({
    description: 'Canonical seat labels defined by the layout.',
    type: [String],
  })
  seatNumbers!: string[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  static from(layout: SeatLayout): SeatLayoutResponseDto {
    return {
      id: layout.id,
      name: layout.name,
      totalSeats: layout.totalSeats,
      seatNumbers: [...layout.seatNumbers],
      createdAt: layout.createdAt.toISOString(),
      updatedAt: layout.updatedAt.toISOString(),
    };
  }
}
