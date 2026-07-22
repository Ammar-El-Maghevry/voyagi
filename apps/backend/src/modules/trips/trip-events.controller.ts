import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
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
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permission } from '../authorization/permission.enum';
import { TripEventResponseDto } from './dto/trip-event-response.dto';
import { TripEventsService } from './trip-events.service';

/**
 * Trip event log (read-only), nested under a trip within `:companyId`. Requires
 * `trips.read`; the trip's company ownership is verified before its events are
 * returned. Events are append-only — there is no write endpoint here.
 */
@ApiTags('trips')
@ApiBearerAuth('bearer')
@ApiParam({ name: 'companyId', description: 'Target company (tenant) id.' })
@ApiParam({ name: 'tripId', description: 'Trip id within the company.' })
@ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid credentials.' })
@ApiForbiddenResponse({
  description: 'No active membership in the company, or the required permission is missing.',
})
@ApiNotFoundResponse({ description: 'No such trip in this company.' })
@Controller({ path: 'companies/:companyId/trips/:tripId/events', version: '1' })
export class TripEventsController {
  constructor(private readonly events: TripEventsService) {}

  @Get()
  @RequirePermissions(Permission.TripsRead)
  @ApiOperation({ summary: "List a trip's lifecycle events (newest first)." })
  @ApiOkResponse({ type: TripEventResponseDto, isArray: true })
  async list(
    @Param('companyId') companyId: string,
    @Param('tripId') tripId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<TripEventResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.events.listTripEvents(companyId, tripId, pagination);
    return new CollectionResult(
      page.items.map(TripEventResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }
}
