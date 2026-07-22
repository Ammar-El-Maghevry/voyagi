import { ApiProperty } from '@nestjs/swagger';
import type { PublicTripPricePreview } from '../availability.types';

export class PricePreviewResponseDto {
  @ApiProperty()
  tripId!: string;

  @ApiProperty({
    type: String,
    example: '500.00',
    description: 'Estimated unit price from the trip price snapshot.',
  })
  estimatedUnitPrice!: string;

  @ApiProperty({ minimum: 1, maximum: 20 })
  passengerCount!: number;

  @ApiProperty({
    type: String,
    example: '1000.00',
    description: 'Estimated unit price multiplied in PostgreSQL by passengerCount.',
  })
  estimatedTotal!: string;

  @ApiProperty({ example: 'MRU' })
  currency!: string;

  @ApiProperty({
    example: true,
    description: 'Always true until a booking fixes its price.',
  })
  isEstimate!: true;

  static from(preview: PublicTripPricePreview): PricePreviewResponseDto {
    return {
      tripId: preview.tripId,
      estimatedUnitPrice: preview.estimatedUnitPrice,
      passengerCount: preview.passengerCount,
      estimatedTotal: preview.estimatedTotal,
      currency: preview.currency,
      isEstimate: preview.isEstimate,
    };
  }
}
