import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Station } from '../station.types';

/** A station as returned by the reference-data endpoints. */
export class StationResponseDto {
  @ApiProperty({ description: 'Station id.' })
  id!: string;

  @ApiProperty({ description: 'City id the station belongs to.' })
  cityId!: string;

  @ApiProperty({ description: 'Station name (Arabic).' })
  nameAr!: string;

  @ApiProperty({ description: 'Station name (French).' })
  nameFr!: string;

  @ApiPropertyOptional({ description: 'Latitude in decimal degrees, when set.' })
  latitude?: number;

  @ApiPropertyOptional({ description: 'Longitude in decimal degrees, when set.' })
  longitude?: number;

  @ApiProperty({ description: 'Whether the station is active.' })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  static from(station: Station): StationResponseDto {
    return {
      id: station.id,
      cityId: station.cityId,
      nameAr: station.nameAr,
      nameFr: station.nameFr,
      latitude: station.latitude,
      longitude: station.longitude,
      isActive: station.isActive,
      createdAt: station.createdAt.toISOString(),
      updatedAt: station.updatedAt.toISOString(),
    };
  }
}
