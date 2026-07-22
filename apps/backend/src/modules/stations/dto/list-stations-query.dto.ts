import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';

/** Positive `bigint` surrogate key as a string (no leading zeros). */
const BIGINT_PATTERN = /^[1-9][0-9]*$/;

/**
 * Query for `GET /stations`: bounded pagination plus an optional `cityId`
 * filter. The id shape is validated here so a malformed value is rejected
 * (`400`) before reaching the database rather than causing a cast error.
 */
export class ListStationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Restrict to a single city id.' })
  @IsOptional()
  @IsString()
  @Matches(BIGINT_PATTERN, { message: 'cityId must be a positive integer id.' })
  cityId?: string;
}
