import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BusStatus } from '../bus-status';
import type { Bus } from '../bus.types';

/** A bus as returned by the fleet endpoints. */
export class BusResponseDto {
  @ApiProperty({ description: 'Bus id.' })
  id!: string;

  @ApiProperty({ description: 'Company id the bus belongs to.' })
  companyId!: string;

  @ApiProperty({ description: 'Seat layout id the bus uses.' })
  seatLayoutId!: string;

  @ApiProperty({ description: 'Registration / plate number.' })
  plateNumber!: string;

  @ApiPropertyOptional({ description: 'Bus model / description, when set.' })
  busModel?: string;

  @ApiProperty({ enum: BusStatus, description: 'Operational status.' })
  status!: BusStatus;

  @ApiProperty({ description: 'Whether the bus is active.' })
  isActive!: boolean;

  @ApiProperty({ description: 'Current odometer reading in km.' })
  currentOdometerKm!: number;

  @ApiProperty({ description: 'Optimistic-concurrency version.' })
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  static from(bus: Bus): BusResponseDto {
    return {
      id: bus.id,
      companyId: bus.companyId,
      seatLayoutId: bus.seatLayoutId,
      plateNumber: bus.plateNumber,
      busModel: bus.busModel,
      status: bus.status,
      isActive: bus.isActive,
      currentOdometerKm: bus.currentOdometerKm,
      version: bus.version,
      createdAt: bus.createdAt.toISOString(),
      updatedAt: bus.updatedAt.toISOString(),
    };
  }
}
