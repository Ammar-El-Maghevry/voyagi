import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { IsPositiveBigInt } from '../request.validators';

export class TripIdParamDto {
  @ApiProperty({ description: 'Public trip id.' })
  @IsString()
  @IsPositiveBigInt({ message: 'tripId must be a positive bigint id.' })
  tripId!: string;
}
