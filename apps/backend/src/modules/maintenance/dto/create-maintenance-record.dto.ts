import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { MaintenanceType } from '../maintenance-type';
import type { MaintenanceCreate } from '../maintenance.types';

const BIGINT_PATTERN = /^[1-9][0-9]*$/;

/** Allowed client fields for a planned maintenance record. */
export class CreateMaintenanceRecordDto {
  @ApiProperty({ description: 'Bus id within X-Company-Id.' })
  @IsString()
  @Matches(BIGINT_PATTERN, { message: 'busId must be a positive integer id.' })
  busId!: string;

  @ApiProperty({ enum: MaintenanceType })
  @IsEnum(MaintenanceType)
  maintenanceType!: MaintenanceType;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Estimated or actual cost in MRU.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  costMru?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometerKm?: number;

  @ApiProperty({ format: 'date-time', description: 'Planned maintenance start.' })
  @Type(() => Date)
  @IsDate()
  startedAt!: Date;

  @ApiProperty({ format: 'date-time', description: 'Planned maintenance end.' })
  @Type(() => Date)
  @IsDate()
  scheduledEndsAt!: Date;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  nextMaintenanceAt?: Date;

  toDomain(): MaintenanceCreate {
    return {
      busId: this.busId,
      maintenanceType: this.maintenanceType,
      description: this.description,
      costMru: this.costMru,
      odometerKm: this.odometerKm,
      startedAt: this.startedAt,
      scheduledEndsAt: this.scheduledEndsAt,
      nextMaintenanceAt: this.nextMaintenanceAt,
    };
  }
}
