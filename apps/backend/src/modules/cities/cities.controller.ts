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
import { CityResponseDto } from './dto/city-response.dto';
import { CitiesService } from './cities.service';

/**
 * City reference-data endpoints.
 *
 * Cities are global reference data readable by any authenticated user (matching
 * the RLS `cities_read_active` policy), so these routes require authentication
 * but declare no permission. There are no write endpoints — reference-catalog
 * management is out of scope for this phase.
 */
@ApiTags('cities')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid credentials.' })
@Controller({ path: 'cities', version: '1' })
export class CitiesController {
  constructor(private readonly cities: CitiesService) {}

  @Get()
  @ApiOperation({ summary: 'List active cities (global reference data).' })
  @ApiOkResponse({ type: CityResponseDto, isArray: true })
  async list(
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<CityResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.cities.listCities(pagination);
    return new CollectionResult(
      page.items.map(CityResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Get(':cityId')
  @ApiOperation({ summary: 'Read a single active city.' })
  @ApiParam({ name: 'cityId', description: 'City id.' })
  @ApiOkResponse({ type: CityResponseDto })
  @ApiNotFoundResponse({ description: 'No such active city.' })
  async getOne(@Param('cityId') cityId: string): Promise<CityResponseDto> {
    const city = await this.cities.getCity(cityId);
    return CityResponseDto.from(city);
  }
}
