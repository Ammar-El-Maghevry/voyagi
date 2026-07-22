import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import type { RoutePriceCreate } from '../route-price.types';

/** ISO-4217-style 3-letter uppercase currency code. */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Request body for `POST /companies/:companyId/routes/:routeId/prices`. Records
 * a new price; the changing user is taken from the verified principal, never the
 * body.
 */
export class CreateRoutePriceDto {
  @ApiProperty({ description: 'New price in MRU (non-negative).', minimum: 0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceMru!: number;

  @ApiPropertyOptional({ description: '3-letter currency code.', default: 'MRU' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Matches(CURRENCY_PATTERN, { message: 'currency must be a 3-letter code.' })
  currency?: string;

  @ApiPropertyOptional({ description: 'Reason for the price change.', maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  changeReason?: string;

  toDomain(changedByUserId: string): RoutePriceCreate {
    return {
      priceMru: this.priceMru,
      currency: this.currency ?? 'MRU',
      changeReason: this.changeReason,
      changedByUserId,
    };
  }
}
