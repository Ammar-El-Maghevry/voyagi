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
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CollectionResult } from '../../common/pagination/collection-result';
import { buildPaginationMeta, resolvePagination } from '../../common/pagination/pagination';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permission } from '../authorization/permission.enum';
import {
  ConfirmPaymentUseCase,
  CreatePaymentUseCase,
  GetPaymentUseCase,
  HandlePaymentWebhookUseCase,
  ListPaymentsUseCase,
  RefundPaymentUseCase,
} from './payment.use-cases';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';

const paymentCollectionResponse = {
  description: 'Standard paginated payment collection envelope.',
  schema: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      data: { type: 'array', items: { $ref: getSchemaPath(PaymentResponseDto) } },
      meta: { type: 'object' },
    },
  },
} as const;

@ApiTags('payments')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication is required.' })
@Controller({ path: 'payments', version: '1' })
export class PassengerPaymentsController {
  constructor(
    private readonly createPayment: CreatePaymentUseCase,
    private readonly getPayment: GetPaymentUseCase,
    private readonly listPayments: ListPaymentsUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Initiate an online payment for an owned booking.' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: PaymentResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid body or Idempotency-Key.' })
  @ApiConflictResponse({ description: 'Idempotency conflict, booking not payable, or already settled.' })
  @ApiUnprocessableEntityResponse({ description: 'The payment method is not allowed.' })
  @ApiNotFoundResponse({ description: 'No owned booking with this id.' })
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreatePaymentDto,
  ): Promise<PaymentResponseDto> {
    return PaymentResponseDto.from(
      await this.createPayment.passenger(principal.userId, key, body.toDomain()),
    );
  }

  @Get()
  @ApiOperation({ summary: 'List the authenticated passenger owner’s payments.' })
  @ApiOkResponse(paymentCollectionResponse)
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<PaymentResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.listPayments.owned(principal.userId, pagination);
    return new CollectionResult(
      page.items.map(PaymentResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Get(':paymentId')
  @ApiOperation({ summary: 'Read one payment owned by the authenticated passenger.' })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiNotFoundResponse({ description: 'No owned payment with this id.' })
  async get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('paymentId') paymentId: string,
  ): Promise<PaymentResponseDto> {
    return PaymentResponseDto.from(await this.getPayment.owned(principal.userId, paymentId));
  }
}

@ApiTags('company payments')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication is required.' })
@ApiForbiddenResponse({ description: 'Company permission or branch entitlement is missing.' })
@Controller({ path: 'companies/:companyId/payments', version: '1' })
export class CompanyPaymentsController {
  constructor(
    private readonly createPayment: CreatePaymentUseCase,
    private readonly getPayment: GetPaymentUseCase,
    private readonly listPayments: ListPaymentsUseCase,
    private readonly confirmPayment: ConfirmPaymentUseCase,
    private readonly refundPayment: RefundPaymentUseCase,
  ) {}

  @Post()
  @RequirePermissions(Permission.PaymentsConfirm)
  @ApiOperation({ summary: 'Record a payment (e.g. cash) against a company booking.' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: PaymentResponseDto })
  @ApiConflictResponse({ description: 'Idempotency conflict, booking not payable, or already settled.' })
  async create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreatePaymentDto,
  ): Promise<PaymentResponseDto> {
    return PaymentResponseDto.from(
      await this.createPayment.company(principal.userId, companyId, key, body.toDomain()),
    );
  }

  @Get()
  @RequirePermissions(Permission.PaymentsRead)
  @ApiOperation({ summary: 'List company payments within the caller’s entitlement scope.' })
  @ApiOkResponse(paymentCollectionResponse)
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<PaymentResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.listPayments.company(principal.userId, companyId, pagination);
    return new CollectionResult(
      page.items.map(PaymentResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Get(':paymentId')
  @RequirePermissions(Permission.PaymentsRead)
  @ApiOperation({ summary: 'Read one company payment within entitlement scope.' })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiNotFoundResponse({ description: 'The scoped payment is not visible.' })
  async get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Param('paymentId') paymentId: string,
  ): Promise<PaymentResponseDto> {
    return PaymentResponseDto.from(
      await this.getPayment.company(principal.userId, companyId, paymentId),
    );
  }

  @Post(':paymentId/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PaymentsConfirm)
  @ApiOperation({ summary: 'Confirm a pending cash payment; confirms the booking.' })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiConflictResponse({ description: 'The payment is not confirmable or already settled.' })
  @ApiUnprocessableEntityResponse({ description: 'Only cash payments are confirmed manually.' })
  @ApiNotFoundResponse({ description: 'The scoped payment is not visible.' })
  async confirm(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Param('paymentId') paymentId: string,
  ): Promise<PaymentResponseDto> {
    return PaymentResponseDto.from(
      await this.confirmPayment.execute(principal.userId, companyId, paymentId),
    );
  }

  @Post(':paymentId/refund')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PaymentsRefund)
  @ApiOperation({ summary: 'Fully refund a succeeded payment.' })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiConflictResponse({ description: 'The payment is not in a refundable state.' })
  @ApiNotFoundResponse({ description: 'The scoped payment is not visible.' })
  async refund(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('companyId') companyId: string,
    @Param('paymentId') paymentId: string,
  ): Promise<PaymentResponseDto> {
    return PaymentResponseDto.from(
      await this.refundPayment.execute(principal.userId, companyId, paymentId),
    );
  }
}

@ApiTags('payment webhooks')
@Controller({ path: 'webhooks/payments', version: '1' })
export class PaymentWebhookController {
  constructor(private readonly handleWebhook: HandlePaymentWebhookUseCase) {}

  @Post(':provider')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive a signed provider payment event (public, signature-verified).' })
  @ApiOkResponse({ description: 'The event was accepted (idempotent).' })
  @ApiBadRequestResponse({ description: 'The webhook signature could not be verified.' })
  @ApiNotFoundResponse({ description: 'Unknown provider or payment.' })
  async receive(
    @Param('provider') provider: string,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<{ received: true }> {
    const rawBody = request.rawBody ?? Buffer.alloc(0);
    return this.handleWebhook.execute(provider, rawBody, request.headers);
  }
}
