import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { RoutePrice } from '../route-price.types';

/** A route price period as returned by the pricing endpoints. */
export class RoutePriceResponseDto {
  @ApiProperty({ description: 'Price period id.' })
  id!: string;

  @ApiProperty({ description: 'Route id.' })
  routeId!: string;

  @ApiProperty({ description: 'Price in MRU.' })
  priceMru!: number;

  @ApiProperty({ description: '3-letter currency code.' })
  currency!: string;

  @ApiProperty({ format: 'date-time', description: 'Start of the effective period.' })
  effectiveFrom!: string;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description: 'End of the effective period; null while this price is current.',
  })
  effectiveTo!: string | null;

  @ApiPropertyOptional({ description: 'Reason for the price change, when recorded.' })
  changeReason?: string;

  @ApiPropertyOptional({ description: 'User id that recorded the change, when known.' })
  changedByUserId?: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  static from(price: RoutePrice): RoutePriceResponseDto {
    return {
      id: price.id,
      routeId: price.routeId,
      priceMru: price.priceMru,
      currency: price.currency,
      effectiveFrom: price.effectiveFrom.toISOString(),
      effectiveTo: price.effectiveTo ? price.effectiveTo.toISOString() : null,
      changeReason: price.changeReason,
      changedByUserId: price.changedByUserId,
      createdAt: price.createdAt.toISOString(),
    };
  }
}
