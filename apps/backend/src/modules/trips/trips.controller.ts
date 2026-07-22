import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CollectionResult } from '../../common/pagination/collection-result';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination/pagination';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permission } from '../authorization/permission.enum';
import { CreateTripDto } from './dto/create-trip.dto';
import { TripResponseDto } from './dto/trip-response.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TripAction } from './trip-transitions';
import { TripsService } from './trips.service';

/**
 * Trip endpoints, scoped to `:companyId` (the tenant target).
 *
 * Trips are company-scoped (no branch dimension): the guard enforces
 * `trips.read` for reads and the company-wide `trips.manage` for writes. Status
 * changes go through the dedicated start/complete/cancel actions (never a
 * generic PATCH), and edits are optimistic-locked.
 */
@ApiTags('trips')
@ApiBearerAuth('bearer')
@ApiParam({ name: 'companyId', description: 'Target company (tenant) id.' })
@ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid credentials.' })
@ApiForbiddenResponse({
  description: 'No active membership in the company, or the required permission is missing.',
})
@Controller({ path: 'companies/:companyId/trips', version: '1' })
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get()
  @RequirePermissions(Permission.TripsRead)
  @ApiOperation({ summary: 'List trips within a company.' })
  @ApiOkResponse({ type: TripResponseDto, isArray: true })
  async list(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<TripResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.trips.listTrips(companyId, pagination);
    return new CollectionResult(
      page.items.map(TripResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Get(':tripId')
  @RequirePermissions(Permission.TripsRead)
  @ApiOperation({ summary: 'Read a single trip within a company.' })
  @ApiParam({ name: 'tripId', description: 'Trip id within the company.' })
  @ApiOkResponse({ type: TripResponseDto })
  @ApiNotFoundResponse({ description: 'No such trip in this company.' })
  async getOne(
    @Param('companyId') companyId: string,
    @Param('tripId') tripId: string,
  ): Promise<TripResponseDto> {
    const trip = await this.trips.getTrip(companyId, tripId);
    return TripResponseDto.from(trip);
  }

  @Post()
  @RequirePermissions(Permission.TripsManage)
  @ApiOperation({ summary: 'Schedule a trip (requires trips.manage).' })
  @ApiCreatedResponse({ type: TripResponseDto })
  @ApiConflictResponse({ description: 'The bus is already scheduled on an overlapping trip.' })
  @ApiUnprocessableEntityResponse({ description: 'Route/bus/times/staff are invalid for the trip.' })
  async create(
    @Param('companyId') companyId: string,
    @Body() body: CreateTripDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<TripResponseDto> {
    const trip = await this.trips.createTrip(companyId, body.toDomain(), principal.userId);
    return TripResponseDto.from(trip);
  }

  @Patch(':tripId')
  @RequirePermissions(Permission.TripsManage)
  @ApiOperation({ summary: 'Edit a scheduled trip (requires trips.manage; optimistic-locked).' })
  @ApiParam({ name: 'tripId', description: 'Trip id within the company.' })
  @ApiOkResponse({ type: TripResponseDto })
  @ApiNotFoundResponse({ description: 'No such trip in this company.' })
  @ApiConflictResponse({ description: 'Stale version, or the trip is no longer editable.' })
  @ApiUnprocessableEntityResponse({ description: 'Times or staff are invalid.' })
  async update(
    @Param('companyId') companyId: string,
    @Param('tripId') tripId: string,
    @Body() body: UpdateTripDto,
  ): Promise<TripResponseDto> {
    const trip = await this.trips.updateTrip(
      companyId,
      tripId,
      body.expectedVersion,
      body.toDomain(),
    );
    return TripResponseDto.from(trip);
  }

  @Post(':tripId/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TripsManage)
  @ApiOperation({ summary: 'Start a scheduled trip (records actual departure).' })
  @ApiParam({ name: 'tripId', description: 'Trip id within the company.' })
  @ApiOkResponse({ type: TripResponseDto })
  @ApiNotFoundResponse({ description: 'No such trip in this company.' })
  @ApiConflictResponse({ description: 'The trip is not in a startable state.' })
  async start(
    @Param('companyId') companyId: string,
    @Param('tripId') tripId: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<TripResponseDto> {
    const trip = await this.trips.applyTransition(companyId, tripId, TripAction.Start, principal.userId);
    return TripResponseDto.from(trip);
  }

  @Post(':tripId/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TripsManage)
  @ApiOperation({ summary: 'Complete an ongoing trip (records actual arrival).' })
  @ApiParam({ name: 'tripId', description: 'Trip id within the company.' })
  @ApiOkResponse({ type: TripResponseDto })
  @ApiNotFoundResponse({ description: 'No such trip in this company.' })
  @ApiConflictResponse({ description: 'The trip is not in a completable state.' })
  async complete(
    @Param('companyId') companyId: string,
    @Param('tripId') tripId: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<TripResponseDto> {
    const trip = await this.trips.applyTransition(companyId, tripId, TripAction.Complete, principal.userId);
    return TripResponseDto.from(trip);
  }

  @Post(':tripId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TripsManage)
  @ApiOperation({ summary: 'Cancel a scheduled trip.' })
  @ApiParam({ name: 'tripId', description: 'Trip id within the company.' })
  @ApiOkResponse({ type: TripResponseDto })
  @ApiNotFoundResponse({ description: 'No such trip in this company.' })
  @ApiConflictResponse({ description: 'The trip is not in a cancellable state.' })
  async cancel(
    @Param('companyId') companyId: string,
    @Param('tripId') tripId: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<TripResponseDto> {
    const trip = await this.trips.applyTransition(companyId, tripId, TripAction.Cancel, principal.userId);
    return TripResponseDto.from(trip);
  }
}
