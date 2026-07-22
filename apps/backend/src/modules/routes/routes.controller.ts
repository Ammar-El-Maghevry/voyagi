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
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permission } from '../authorization/permission.enum';
import { CreateRouteDto } from './dto/create-route.dto';
import { RouteResponseDto } from './dto/route-response.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { RoutesService } from './routes.service';

/**
 * Route endpoints, scoped to `:companyId` (the tenant target).
 *
 * Routes are company-scoped: the guard enforces `routes.read` for reads and the
 * company-wide `routes.manage` for writes; every query is filtered by
 * `companyId`. Prices are managed through the sibling pricing controller.
 */
@ApiTags('routes')
@ApiBearerAuth('bearer')
@ApiParam({ name: 'companyId', description: 'Target company (tenant) id.' })
@ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid credentials.' })
@ApiForbiddenResponse({
  description: 'No active membership in the company, or the required permission is missing.',
})
@Controller({ path: 'companies/:companyId/routes', version: '1' })
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Get()
  @RequirePermissions(Permission.RoutesRead)
  @ApiOperation({ summary: 'List routes within a company.' })
  @ApiOkResponse({ type: RouteResponseDto, isArray: true })
  async list(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<RouteResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.routes.listRoutes(companyId, pagination);
    return new CollectionResult(
      page.items.map(RouteResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Get(':routeId')
  @RequirePermissions(Permission.RoutesRead)
  @ApiOperation({ summary: 'Read a single route within a company.' })
  @ApiParam({ name: 'routeId', description: 'Route id within the company.' })
  @ApiOkResponse({ type: RouteResponseDto })
  @ApiNotFoundResponse({ description: 'No such route in this company.' })
  async getOne(
    @Param('companyId') companyId: string,
    @Param('routeId') routeId: string,
  ): Promise<RouteResponseDto> {
    const route = await this.routes.getRoute(companyId, routeId);
    return RouteResponseDto.from(route);
  }

  @Post()
  @RequirePermissions(Permission.RoutesManage)
  @ApiOperation({ summary: 'Create a route (requires routes.manage).' })
  @ApiCreatedResponse({ type: RouteResponseDto })
  @ApiConflictResponse({ description: 'A route with the same origin/destination already exists.' })
  @ApiUnprocessableEntityResponse({ description: 'Origin/destination are not distinct, active stations.' })
  async create(
    @Param('companyId') companyId: string,
    @Body() body: CreateRouteDto,
  ): Promise<RouteResponseDto> {
    const route = await this.routes.createRoute(companyId, body.toDomain());
    return RouteResponseDto.from(route);
  }

  @Patch(':routeId')
  @RequirePermissions(Permission.RoutesManage)
  @ApiOperation({ summary: 'Update a route (requires routes.manage).' })
  @ApiParam({ name: 'routeId', description: 'Route id within the company.' })
  @ApiOkResponse({ type: RouteResponseDto })
  @ApiNotFoundResponse({ description: 'No such route in this company.' })
  @ApiConflictResponse({ description: 'A route with the same origin/destination already exists.' })
  @ApiUnprocessableEntityResponse({ description: 'Origin/destination are not distinct, active stations.' })
  async update(
    @Param('companyId') companyId: string,
    @Param('routeId') routeId: string,
    @Body() body: UpdateRouteDto,
  ): Promise<RouteResponseDto> {
    const route = await this.routes.updateRoute(companyId, routeId, body.toDomain());
    return RouteResponseDto.from(route);
  }

  @Post(':routeId/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.RoutesManage)
  @ApiOperation({ summary: 'Activate a route (requires routes.manage).' })
  @ApiParam({ name: 'routeId', description: 'Route id within the company.' })
  @ApiOkResponse({ type: RouteResponseDto })
  @ApiNotFoundResponse({ description: 'No such route in this company.' })
  @ApiConflictResponse({ description: 'The route is already active.' })
  async activate(
    @Param('companyId') companyId: string,
    @Param('routeId') routeId: string,
  ): Promise<RouteResponseDto> {
    const route = await this.routes.setRouteActive(companyId, routeId, true);
    return RouteResponseDto.from(route);
  }

  @Post(':routeId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.RoutesManage)
  @ApiOperation({ summary: 'Deactivate a route (requires routes.manage).' })
  @ApiParam({ name: 'routeId', description: 'Route id within the company.' })
  @ApiOkResponse({ type: RouteResponseDto })
  @ApiNotFoundResponse({ description: 'No such route in this company.' })
  @ApiConflictResponse({ description: 'The route is already inactive.' })
  async deactivate(
    @Param('companyId') companyId: string,
    @Param('routeId') routeId: string,
  ): Promise<RouteResponseDto> {
    const route = await this.routes.setRouteActive(companyId, routeId, false);
    return RouteResponseDto.from(route);
  }
}
