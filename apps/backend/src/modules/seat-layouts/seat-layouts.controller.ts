import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CollectionResult } from '../../common/pagination/collection-result';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination/pagination';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { SeatLayoutResponseDto } from './dto/seat-layout-response.dto';
import { SeatLayoutsService } from './seat-layouts.service';

/**
 * Seat-layout endpoints.
 *
 * Seat layouts are global templates readable by any authenticated user
 * (matching the RLS `seat_layouts_read` policy), so these routes require
 * authentication but declare no permission. There are no write endpoints —
 * template management is out of scope for this phase.
 */
@ApiTags('seat-layouts')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid credentials.' })
@Controller({ path: 'seat-layouts', version: '1' })
export class SeatLayoutsController {
  constructor(private readonly seatLayouts: SeatLayoutsService) {}

  @Get()
  @ApiOperation({ summary: 'List seat layouts (global templates).' })
  @ApiOkResponse({ type: SeatLayoutResponseDto, isArray: true })
  async list(
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<SeatLayoutResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.seatLayouts.listSeatLayouts(pagination);
    return new CollectionResult(
      page.items.map(SeatLayoutResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Get(':seatLayoutId')
  @ApiOperation({ summary: 'Read a single seat layout.' })
  @ApiParam({ name: 'seatLayoutId', description: 'Seat layout id.' })
  @ApiOkResponse({ type: SeatLayoutResponseDto })
  @ApiNotFoundResponse({ description: 'No such seat layout.' })
  async getOne(
    @Param('seatLayoutId') seatLayoutId: string,
  ): Promise<SeatLayoutResponseDto> {
    const layout = await this.seatLayouts.getSeatLayout(seatLayoutId);
    return SeatLayoutResponseDto.from(layout);
  }
}
