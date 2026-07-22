import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import { IsPositiveBigInt, IsYyyyMmDd } from '../request.validators';

/** Required public trip-search filters plus bounded pagination. */
export class SearchPublicTripsQueryDto extends PaginationQueryDto {
  @ApiProperty({ description: 'Active origin station id.' })
  @IsString()
  @IsPositiveBigInt({
    message: 'originStationId must be a positive bigint id.',
  })
  originStationId!: string;

  @ApiProperty({ description: 'Active destination station id.' })
  @IsString()
  @IsPositiveBigInt({
    message: 'destinationStationId must be a positive bigint id.',
  })
  destinationStationId!: string;

  @ApiProperty({ format: 'date', example: '2026-07-22' })
  @IsString()
  @IsYyyyMmDd({ message: 'date must be a valid date in YYYY-MM-DD format.' })
  date!: string;
}
