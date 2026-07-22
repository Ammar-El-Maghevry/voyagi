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
import { ListStationsQueryDto } from './dto/list-stations-query.dto';
import { StationResponseDto } from './dto/station-response.dto';
import { StationsService } from './stations.service';

/**
 * Station reference-data endpoints.
 *
 * Stations are city-scoped reference data readable by any authenticated user
 * (matching the RLS `stations_read_active` policy), so these routes require
 * authentication but declare no permission. There are no write endpoints —
 * reference-catalog management is out of scope for this phase.
 */
@ApiTags('stations')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid credentials.' })
@Controller({ path: 'stations', version: '1' })
export class StationsController {
  constructor(private readonly stations: StationsService) {}

  @Get()
  @ApiOperation({ summary: 'List active stations, optionally filtered by city.' })
  @ApiOkResponse({ type: StationResponseDto, isArray: true })
  async list(
    @Query() query: ListStationsQueryDto,
  ): Promise<CollectionResult<StationResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.stations.listStations(pagination, query.cityId);
    return new CollectionResult(
      page.items.map(StationResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Get(':stationId')
  @ApiOperation({ summary: 'Read a single active station.' })
  @ApiParam({ name: 'stationId', description: 'Station id.' })
  @ApiOkResponse({ type: StationResponseDto })
  @ApiNotFoundResponse({ description: 'No such active station.' })
  async getOne(
    @Param('stationId') stationId: string,
  ): Promise<StationResponseDto> {
    const station = await this.stations.getStation(stationId);
    return StationResponseDto.from(station);
  }
}
