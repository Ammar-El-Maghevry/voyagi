import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
import { CreateRoutePriceDto } from './dto/create-route-price.dto';
import { RoutePriceResponseDto } from './dto/route-price-response.dto';
import { RoutePricesService } from './route-prices.service';

/**
 * Route pricing endpoints, nested under a route within `:companyId`.
 *
 * Reading price history requires `routes.read`; recording a new price requires
 * the company-wide `routes.manage` (there is no dedicated pricing permission).
 * Route ownership within the company is verified before any pricing access.
 */
@ApiTags('routes')
@ApiBearerAuth('bearer')
@ApiParam({ name: 'companyId', description: 'Target company (tenant) id.' })
@ApiParam({ name: 'routeId', description: 'Route id within the company.' })
@ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid credentials.' })
@ApiForbiddenResponse({
  description: 'No active membership in the company, or the required permission is missing.',
})
@ApiNotFoundResponse({ description: 'No such route in this company.' })
@Controller({ path: 'companies/:companyId/routes/:routeId', version: '1' })
export class RoutePricesController {
  constructor(private readonly prices: RoutePricesService) {}

  @Get('price-history')
  @RequirePermissions(Permission.RoutesRead)
  @ApiOperation({ summary: "List a route's price history (newest first)." })
  @ApiOkResponse({ type: RoutePriceResponseDto, isArray: true })
  async history(
    @Param('companyId') companyId: string,
    @Param('routeId') routeId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<RoutePriceResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.prices.listPriceHistory(companyId, routeId, pagination);
    return new CollectionResult(
      page.items.map(RoutePriceResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Post('prices')
  @RequirePermissions(Permission.RoutesManage)
  @ApiOperation({ summary: 'Record a new route price (requires routes.manage).' })
  @ApiCreatedResponse({ type: RoutePriceResponseDto })
  @ApiConflictResponse({ description: 'A concurrent price change conflicted; retry.' })
  async create(
    @Param('companyId') companyId: string,
    @Param('routeId') routeId: string,
    @Body() body: CreateRoutePriceDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<RoutePriceResponseDto> {
    const period = await this.prices.createPrice(
      companyId,
      routeId,
      body.toDomain(principal.userId),
    );
    return RoutePriceResponseDto.from(period);
  }
}
