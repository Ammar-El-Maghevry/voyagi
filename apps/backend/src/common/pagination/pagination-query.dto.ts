import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type PaginationParams,
} from './pagination';

/**
 * Shared bounded pagination query for collection endpoints. Out-of-range values
 * are normalized by `resolvePagination`; validation here only rejects
 * non-integer input. Matches the collection contract in
 * `architecture/14-api-design-standards.md` (default page 1, size 20, max 100).
 */
export class PaginationQueryDto implements PaginationParams {
  @ApiPropertyOptional({ minimum: 1, default: 1, description: '1-based page number.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
    description: `Items per page (clamped to ${MAX_PAGE_SIZE}).`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
