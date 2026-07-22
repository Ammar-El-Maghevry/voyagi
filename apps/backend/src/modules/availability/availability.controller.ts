import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CollectionResult } from '../../common/pagination/collection-result';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination/pagination';
import { AvailabilityService } from './availability.service';
import { PricePreviewResponseDto } from './dto/price-preview-response.dto';
import { PricePreviewQueryDto } from './dto/price-preview-query.dto';
import { PublicTripResponseDto } from './dto/public-trip-response.dto';
import { SearchPublicTripsQueryDto } from './dto/search-public-trips-query.dto';
import { TripAvailabilityResponseDto } from './dto/trip-availability-response.dto';
import { TripIdParamDto } from './dto/trip-id-param.dto';

@ApiTags('public trips')
@ApiExtraModels(PublicTripResponseDto)
@Public()
@Controller({ path: 'trips', version: '1' })
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search publicly bookable scheduled trips.' })
  @ApiOkResponse({
    description: 'Standard collection envelope with deterministic pagination metadata.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'array', items: { $ref: getSchemaPath(PublicTripResponseDto) } },
        meta: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            pageSize: { type: 'integer' },
            total: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid station, date, or pagination filter.' })
  async search(
    @Query() query: SearchPublicTripsQueryDto,
  ): Promise<CollectionResult<PublicTripResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.availability.searchTrips(
      query.originStationId,
      query.destinationStationId,
      query.date,
      pagination,
    );
    return new CollectionResult(
      page.items.map(PublicTripResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Get(':tripId/availability')
  @ApiOperation({
    summary: 'Read privacy-safe seat availability for a public trip.',
  })
  @ApiParam({ name: 'tripId', description: 'Public trip id.' })
  @ApiOkResponse({ type: TripAvailabilityResponseDto })
  @ApiNotFoundResponse({
    description: 'No publicly available trip with this id.',
  })
  @ApiBadRequestResponse({ description: 'The trip id is not a positive bigint.' })
  async getAvailability(
    @Param() params: TripIdParamDto,
  ): Promise<TripAvailabilityResponseDto> {
    return TripAvailabilityResponseDto.from(
      await this.availability.getAvailability(params.tripId),
    );
  }

  @Get(':tripId/price-preview')
  @ApiOperation({ summary: 'Read the current estimated trip price.' })
  @ApiParam({ name: 'tripId', description: 'Public trip id.' })
  @ApiOkResponse({ type: PricePreviewResponseDto })
  @ApiNotFoundResponse({
    description: 'No publicly available trip with this id.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid trip id or passengerCount outside the inclusive range 1..20.',
  })
  async getPricePreview(
    @Param() params: TripIdParamDto,
    @Query() query: PricePreviewQueryDto,
  ): Promise<PricePreviewResponseDto> {
    return PricePreviewResponseDto.from(
      await this.availability.getPricePreview(params.tripId, query.passengerCount),
    );
  }
}
