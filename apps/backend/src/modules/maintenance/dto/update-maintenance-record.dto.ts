import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { MaintenanceAction } from '../maintenance-transitions';

/** PATCH deliberately accepts an action only; records are not generically editable. */
export class UpdateMaintenanceRecordDto {
  @ApiProperty({ enum: MaintenanceAction })
  @IsEnum(MaintenanceAction)
  action!: MaintenanceAction;
}
