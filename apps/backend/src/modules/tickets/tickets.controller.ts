import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
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
import { RateLimit } from '../../common/rate-limit/rate-limit.policies';
import { Permission } from '../authorization/permission.enum';
import {
  GetTicketUseCase,
  IssueTicketUseCase,
  ListTicketsUseCase,
  RevokeTicketUseCase,
  ValidateTicketUseCase,
  VerifyTicketUseCase,
} from './ticket.use-cases';
import {
  IssuedTicketResponseDto,
  TicketResponseDto,
  TicketVerificationResponseDto,
} from './dto/ticket-response.dto';
import { VerifyTicketDto } from './dto/verify-ticket.dto';

const ticketCollectionResponse = {
  description: 'Standard paginated ticket collection envelope.',
  schema: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      data: {
        type: 'array',
        items: { $ref: getSchemaPath(TicketResponseDto) },
      },
      meta: { type: 'object' },
    },
  },
} as const;

@ApiTags('tickets')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication is required.' })
@Controller({ version: '1' })
export class PassengerTicketsController {
  constructor(
    private readonly issueTicket: IssueTicketUseCase,
    private readonly getTicket: GetTicketUseCase,
    private readonly listTickets: ListTicketsUseCase,
  ) {}

  @Post('bookings/:bookingId/tickets')
  @ApiOperation({
    summary: 'Issue tickets for an owned, confirmed and paid booking.',
  })
  @ApiCreatedResponse({ type: IssuedTicketResponseDto, isArray: true })
  @ApiConflictResponse({ description: 'The booking is not confirmed/paid.' })
  @ApiNotFoundResponse({ description: 'No owned booking with this id.' })
  async issue(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('bookingId') bookingId: string,
  ): Promise<IssuedTicketResponseDto[]> {
    const tickets = await this.issueTicket.owned(principal.userId, bookingId);
    return tickets.map(IssuedTicketResponseDto.fromIssued);
  }

  @Get('bookings/:bookingId/tickets')
  @ApiOperation({ summary: 'List tickets for an owned booking.' })
  @ApiOkResponse({ type: TicketResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: 'No owned booking with this id.' })
  async listForBooking(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('bookingId') bookingId: string,
  ): Promise<TicketResponseDto[]> {
    const tickets = await this.listTickets.ownedBooking(
      principal.userId,
      bookingId,
    );
    return tickets.map(TicketResponseDto.from);
  }

  @Get('tickets')
  @ApiOperation({
    summary: 'List the authenticated passenger owner’s tickets.',
  })
  @ApiOkResponse(ticketCollectionResponse)
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<TicketResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.listTickets.owned(principal.userId, pagination);
    return new CollectionResult(
      page.items.map(TicketResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Get('tickets/:ticketId')
  @ApiOperation({
    summary: 'Read one ticket owned by the authenticated passenger.',
  })
  @ApiOkResponse({ type: TicketResponseDto })
  @ApiNotFoundResponse({ description: 'No owned ticket with this id.' })
  async get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('ticketId') ticketId: string,
  ): Promise<TicketResponseDto> {
    return TicketResponseDto.from(
      await this.getTicket.owned(principal.userId, ticketId),
    );
  }
}

@ApiTags('company tickets')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication is required.' })
@ApiForbiddenResponse({
  description: 'Company permission or branch entitlement is missing.',
})
@Controller({ path: 'companies/:companyId', version: '1' })
export class CompanyTicketsController {
  constructor(
    private readonly issueTicket: IssueTicketUseCase,
    private readonly getTicket: GetTicketUseCase,
    private readonly listTickets: ListTicketsUseCase,
    private readonly validateTicket: ValidateTicketUseCase,
    private readonly verifyTicket: VerifyTicketUseCase,
    private readonly revokeTicket: RevokeTicketUseCase,
  ) {}

  @Post('bookings/:bookingId/tickets')
  @RequirePermissions(Permission.TicketsIssue)
  @ApiOperation({
    summary: 'Issue tickets for a confirmed, paid company booking.',
  })
  @ApiCreatedResponse({ type: IssuedTicketResponseDto, isArray: true })
  @ApiConflictResponse({ description: 'The booking is not confirmed/paid.' })
  @ApiNotFoundResponse({ description: 'The scoped booking is not visible.' })
  async issue(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Param('bookingId') bookingId: string,
  ): Promise<IssuedTicketResponseDto[]> {
    const tickets = await this.issueTicket.company(
      principal.userId,
      companyId,
      bookingId,
    );
    return tickets.map(IssuedTicketResponseDto.fromIssued);
  }

  @Get('bookings/:bookingId/tickets')
  @RequirePermissions(Permission.TicketsRead)
  @ApiOperation({
    summary: 'List tickets for a company booking within entitlement scope.',
  })
  @ApiOkResponse({ type: TicketResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: 'The scoped booking is not visible.' })
  async listForBooking(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Param('bookingId') bookingId: string,
  ): Promise<TicketResponseDto[]> {
    const tickets = await this.listTickets.companyBooking(
      principal.userId,
      companyId,
      bookingId,
    );
    return tickets.map(TicketResponseDto.from);
  }

  @Get('tickets')
  @RequirePermissions(Permission.TicketsRead)
  @ApiOperation({ summary: 'List company tickets within entitlement scope.' })
  @ApiOkResponse(ticketCollectionResponse)
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<TicketResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.listTickets.company(
      principal.userId,
      companyId,
      pagination,
    );
    return new CollectionResult(
      page.items.map(TicketResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Post('tickets/verify')
  @RateLimit('ticketVerify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TicketsValidate)
  @ApiOperation({
    summary: 'Verify a scanned QR token (read-only) within entitlement scope.',
  })
  @ApiOkResponse({ type: TicketVerificationResponseDto })
  @ApiNotFoundResponse({
    description: 'The token does not resolve to a visible ticket.',
  })
  async verify(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Body() body: VerifyTicketDto,
  ): Promise<TicketVerificationResponseDto> {
    return TicketVerificationResponseDto.from(
      await this.verifyTicket.execute(
        principal.userId,
        companyId,
        body.qrToken,
      ),
    );
  }

  @Get('tickets/:ticketId')
  @RequirePermissions(Permission.TicketsRead)
  @ApiOperation({
    summary: 'Read one company ticket within entitlement scope.',
  })
  @ApiOkResponse({ type: TicketResponseDto })
  @ApiNotFoundResponse({ description: 'The scoped ticket is not visible.' })
  async get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Param('ticketId') ticketId: string,
  ): Promise<TicketResponseDto> {
    return TicketResponseDto.from(
      await this.getTicket.company(principal.userId, companyId, ticketId),
    );
  }

  @Post('tickets/:ticketId/validate')
  @RateLimit('ticketValidate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TicketsValidate)
  @ApiOperation({ summary: 'Validate (check in) a ticket at boarding.' })
  @ApiOkResponse({ type: TicketResponseDto })
  @ApiConflictResponse({
    description: 'The ticket is revoked, unpaid, or already used.',
  })
  @ApiNotFoundResponse({ description: 'The scoped ticket is not visible.' })
  async validate(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Param('ticketId') ticketId: string,
  ): Promise<TicketResponseDto> {
    return TicketResponseDto.from(
      await this.validateTicket.execute(principal.userId, companyId, ticketId),
    );
  }

  @Post('tickets/:ticketId/revoke')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TicketsIssue)
  @ApiOperation({ summary: 'Revoke an issued, not-yet-used ticket.' })
  @ApiOkResponse({ type: TicketResponseDto })
  @ApiConflictResponse({
    description: 'The ticket is already used or revoked.',
  })
  @ApiNotFoundResponse({ description: 'The scoped ticket is not visible.' })
  async revoke(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Param('ticketId') ticketId: string,
  ): Promise<TicketResponseDto> {
    return TicketResponseDto.from(
      await this.revokeTicket.execute(principal.userId, companyId, ticketId),
    );
  }
}
