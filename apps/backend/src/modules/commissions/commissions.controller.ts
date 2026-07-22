import { Controller, Get, Headers, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { CollectionResult } from '../../common/pagination/collection-result';
import { buildPaginationMeta, resolvePagination } from '../../common/pagination/pagination';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { COMPANY_ID_HEADER } from '../authorization/company-id.util';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permission } from '../authorization/permission.enum';
import { CommissionTransactionResponseDto } from './dto/commission-transaction-response.dto';
import { CommissionsService } from './commissions.service';

const commissionCollectionResponse = {
  description: 'Standard paginated commission transaction collection envelope.',
  schema: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      data: { type: 'array', items: { $ref: getSchemaPath(CommissionTransactionResponseDto) } },
      meta: { type: 'object' },
    },
  },
} as const;

@ApiTags('agent commissions')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Company-Id', required: true, description: 'Target company id.' })
@ApiUnauthorizedResponse({ description: 'Authentication is required.' })
@ApiForbiddenResponse({ description: 'Company membership or permission is missing.' })
@Controller({ path: 'agent-commission-transactions', version: '1' })
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get()
  @RequirePermissions(Permission.CommissionsRead)
  @ApiOperation({ summary: 'List commission transactions for X-Company-Id.' })
  @ApiOkResponse(commissionCollectionResponse)
  async list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Headers(COMPANY_ID_HEADER) companyId: string | undefined,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<CommissionTransactionResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.commissions.listTransactions(principal.userId, companyId, pagination);
    return new CollectionResult(
      page.items.map(CommissionTransactionResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }
}
