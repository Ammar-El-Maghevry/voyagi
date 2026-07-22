import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { CollectionResult } from '../../common/pagination/collection-result';
import { buildPaginationMeta, resolvePagination } from '../../common/pagination/pagination';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permission } from '../authorization/permission.enum';
import {
  CancelBookingUseCase,
  CreateAgentBookingUseCase,
  CreatePassengerBookingUseCase,
  GetBookingUseCase,
  ListBookingEventsUseCase,
  ListBookingsUseCase,
} from './booking.use-cases';
import { BookingEventResponseDto, BookingResponseDto } from './dto/booking-response.dto';
import { CreateAgentBookingDto, CreateBookingDto } from './dto/create-booking.dto';

const bookingEventCollectionResponse = {
  description: 'Standard paginated event collection envelope.',
  schema: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      data: {
        type: 'array',
        items: { $ref: getSchemaPath(BookingEventResponseDto) },
      },
      meta: { type: 'object' },
    },
  },
} as const;

@ApiTags('bookings')
@ApiExtraModels(BookingResponseDto, BookingEventResponseDto)
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication is required.' })
@Controller({ path: 'bookings', version: '1' })
export class PassengerBookingsController {
  constructor(
    private readonly createBooking: CreatePassengerBookingUseCase,
    private readonly getBooking: GetBookingUseCase,
    private readonly listBookings: ListBookingsUseCase,
    private readonly cancelBooking: CancelBookingUseCase,
    private readonly listEvents: ListBookingEventsUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create an authenticated passenger-owned seat hold.' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: BookingResponseDto })
  @ApiConflictResponse({ description: 'Seat or idempotency conflict, or trip not bookable.' })
  @ApiBadRequestResponse({ description: 'Invalid body or Idempotency-Key.' })
  @ApiUnprocessableEntityResponse({ description: 'Passenger or seat selection is invalid.' })
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreateBookingDto,
  ): Promise<BookingResponseDto> {
    return BookingResponseDto.from(
      await this.createBooking.execute(principal.userId, key, body.toDomain()),
    );
  }

  @Get()
  @ApiOperation({ summary: 'List only the authenticated passenger owner’s online bookings.' })
  @ApiOkResponse({
    description: 'Standard paginated collection envelope.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'array', items: { $ref: getSchemaPath(BookingResponseDto) } },
        meta: { type: 'object' },
      },
    },
  })
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<BookingResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.listBookings.owned(principal.userId, pagination);
    return new CollectionResult(
      page.items.map(BookingResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Get(':bookingId')
  @ApiOkResponse({ type: BookingResponseDto })
  @ApiOperation({ summary: 'Read one authenticated passenger-owned online booking.' })
  @ApiNotFoundResponse({ description: 'No owned booking with this id.' })
  async get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('bookingId') bookingId: string,
  ): Promise<BookingResponseDto> {
    return BookingResponseDto.from(await this.getBooking.owned(principal.userId, bookingId));
  }

  @Post(':bookingId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BookingResponseDto })
  @ApiOperation({ summary: 'Cancel an unpaid passenger-owned hold.' })
  @ApiConflictResponse({ description: 'The booking is terminal or not cancellable.' })
  @ApiNotFoundResponse({ description: 'No passenger-owned online booking with this id.' })
  async cancel(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('bookingId') bookingId: string,
  ): Promise<BookingResponseDto> {
    return BookingResponseDto.from(await this.cancelBooking.owned(principal.userId, bookingId));
  }

  @Get(':bookingId/events')
  @ApiOkResponse(bookingEventCollectionResponse)
  @ApiOperation({ summary: 'List sanitized events for a passenger-owned booking.' })
  @ApiNotFoundResponse({ description: 'No passenger-owned online booking with this id.' })
  async events(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('bookingId') bookingId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<BookingEventResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.listEvents.owned(principal.userId, bookingId, pagination);
    return new CollectionResult(
      page.items.map(BookingEventResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }
}

@ApiTags('company bookings')
@ApiExtraModels(BookingResponseDto, BookingEventResponseDto)
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication is required.' })
@ApiForbiddenResponse({ description: 'Company permission or branch entitlement is missing.' })
@Controller({ path: 'companies/:companyId/bookings', version: '1' })
export class CompanyBookingsController {
  constructor(
    private readonly createBooking: CreateAgentBookingUseCase,
    private readonly getBooking: GetBookingUseCase,
    private readonly listBookings: ListBookingsUseCase,
    private readonly cancelBooking: CancelBookingUseCase,
    private readonly listEvents: ListBookingEventsUseCase,
  ) {}

  @Post()
  @RequirePermissions(Permission.BookingsCreate)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: BookingResponseDto })
  @ApiOperation({ summary: 'Create a branch-scoped agent booking hold.' })
  @ApiBadRequestResponse({ description: 'Invalid body or Idempotency-Key.' })
  @ApiConflictResponse({ description: 'Seat, idempotency, or trip-bookability conflict.' })
  @ApiUnprocessableEntityResponse({ description: 'Passenger or seat selection is invalid.' })
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreateAgentBookingDto,
  ): Promise<BookingResponseDto> {
    return BookingResponseDto.from(
      await this.createBooking.execute(
        principal.userId,
        companyId,
        body.branchId,
        key,
        body.toDomain(),
      ),
    );
  }

  @Get()
  @RequirePermissions(Permission.BookingsRead)
  @ApiOperation({ summary: 'List company bookings within the caller’s entitlement scope.' })
  @ApiOkResponse({
    description: 'Standard paginated collection envelope.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'array', items: { $ref: getSchemaPath(BookingResponseDto) } },
        meta: { type: 'object' },
      },
    },
  })
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<BookingResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.listBookings.company(principal.userId, companyId, pagination);
    return new CollectionResult(
      page.items.map(BookingResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Get(':bookingId')
  @RequirePermissions(Permission.BookingsRead)
  @ApiOkResponse({ type: BookingResponseDto })
  @ApiOperation({ summary: 'Read one company booking within entitlement scope.' })
  @ApiNotFoundResponse({ description: 'The scoped booking is not visible.' })
  async get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Param('bookingId') bookingId: string,
  ): Promise<BookingResponseDto> {
    return BookingResponseDto.from(
      await this.getBooking.company(principal.userId, companyId, bookingId),
    );
  }

  @Post(':bookingId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.BookingsCancel)
  @ApiOkResponse({ type: BookingResponseDto })
  @ApiOperation({ summary: 'Cancel an unpaid booking within branch entitlement scope.' })
  @ApiConflictResponse({ description: 'The booking is terminal or not cancellable.' })
  @ApiNotFoundResponse({ description: 'The scoped booking is not visible.' })
  async cancel(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Param('bookingId') bookingId: string,
  ): Promise<BookingResponseDto> {
    return BookingResponseDto.from(
      await this.cancelBooking.company(principal.userId, companyId, bookingId),
    );
  }

  @Get(':bookingId/events')
  @RequirePermissions(Permission.BookingsRead)
  @ApiOkResponse(bookingEventCollectionResponse)
  @ApiOperation({ summary: 'List sanitized company booking events within entitlement scope.' })
  @ApiNotFoundResponse({ description: 'The scoped booking is not visible.' })
  async events(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Param('bookingId') bookingId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<BookingEventResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.listEvents.company(
      principal.userId,
      companyId,
      bookingId,
      pagination,
    );
    return new CollectionResult(
      page.items.map(BookingEventResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }
}
