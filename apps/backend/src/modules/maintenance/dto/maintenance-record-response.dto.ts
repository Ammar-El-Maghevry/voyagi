import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MaintenanceStatus } from '../maintenance-status';
import { MaintenanceType } from '../maintenance-type';
import type { MaintenanceRecord } from '../maintenance.types';

export class MaintenanceRecordResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() companyId!: string;
  @ApiProperty() busId!: string;
  @ApiProperty({ enum: MaintenanceType }) maintenanceType!: MaintenanceType;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ enum: MaintenanceStatus }) status!: MaintenanceStatus;
  @ApiPropertyOptional() costMru?: number;
  @ApiPropertyOptional() odometerKm?: number;
  @ApiProperty() startedAt!: Date;
  @ApiPropertyOptional() scheduledEndsAt?: Date;
  @ApiPropertyOptional() completedAt?: Date;
  @ApiPropertyOptional() nextMaintenanceAt?: Date;
  @ApiPropertyOptional() createdByUserId?: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static from(record: MaintenanceRecord): MaintenanceRecordResponseDto {
    return Object.assign(new MaintenanceRecordResponseDto(), record);
  }
}
