import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PricePreviewQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 20,
    default: 1,
    description: 'Passenger count used only to estimate the total; no seat is reserved.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  passengerCount = 1;
}
