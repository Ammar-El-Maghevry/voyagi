import { ApiProperty } from '@nestjs/swagger';
import type { City } from '../city.types';

/** A city as returned by the reference-data endpoints. */
export class CityResponseDto {
  @ApiProperty({ description: 'City id.' })
  id!: string;

  @ApiProperty({ description: 'City name (Arabic).' })
  nameAr!: string;

  @ApiProperty({ description: 'City name (French).' })
  nameFr!: string;

  @ApiProperty({ description: 'Whether the city is active.' })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  static from(city: City): CityResponseDto {
    return {
      id: city.id,
      nameAr: city.nameAr,
      nameFr: city.nameFr,
      isActive: city.isActive,
      createdAt: city.createdAt.toISOString(),
    };
  }
}
