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
} from '@nestjs/swagger';
import { CollectionResult } from '../../common/pagination/collection-result';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination/pagination';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permission } from '../authorization/permission.enum';
import { BusesService } from './buses.service';
import { BusResponseDto } from './dto/bus-response.dto';
import { CreateBusDto } from './dto/create-bus.dto';
import { UpdateBusDto } from './dto/update-bus.dto';

/**
 * Fleet (bus) endpoints, scoped to `:companyId` (the tenant target).
 *
 * Buses are company-scoped: the guard enforces `fleet.read` for reads and the
 * company-wide `fleet.manage` for writes; every query is filtered by
 * `companyId`, so no other company's buses are ever returned or mutated. There
 * is no branch dimension. Operational `status` is maintenance-driven and not
 * mutated here; `isActive` uses dedicated activate/deactivate transitions.
 */
@ApiTags('fleet')
@ApiBearerAuth('bearer')
@ApiParam({ name: 'companyId', description: 'Target company (tenant) id.' })
@ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid credentials.' })
@ApiForbiddenResponse({
  description: 'No active membership in the company, or the required permission is missing.',
})
@Controller({ path: 'companies/:companyId/buses', version: '1' })
export class BusesController {
  constructor(private readonly buses: BusesService) {}

  @Get()
  @RequirePermissions(Permission.FleetRead)
  @ApiOperation({ summary: 'List buses within a company.' })
  @ApiOkResponse({ type: BusResponseDto, isArray: true })
  async list(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<BusResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.buses.listBuses(companyId, pagination);
    return new CollectionResult(
      page.items.map(BusResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Get(':busId')
  @RequirePermissions(Permission.FleetRead)
  @ApiOperation({ summary: 'Read a single bus within a company.' })
  @ApiParam({ name: 'busId', description: 'Bus id within the company.' })
  @ApiOkResponse({ type: BusResponseDto })
  @ApiNotFoundResponse({ description: 'No such bus in this company.' })
  async getOne(
    @Param('companyId') companyId: string,
    @Param('busId') busId: string,
  ): Promise<BusResponseDto> {
    const bus = await this.buses.getBus(companyId, busId);
    return BusResponseDto.from(bus);
  }

  @Post()
  @RequirePermissions(Permission.FleetManage)
  @ApiOperation({ summary: 'Create a bus (requires fleet.manage).' })
  @ApiCreatedResponse({ type: BusResponseDto })
  @ApiConflictResponse({
    description: 'Duplicate plate number, or the seat layout does not exist.',
  })
  async create(
    @Param('companyId') companyId: string,
    @Body() body: CreateBusDto,
  ): Promise<BusResponseDto> {
    const bus = await this.buses.createBus(companyId, body.toDomain());
    return BusResponseDto.from(bus);
  }

  @Patch(':busId')
  @RequirePermissions(Permission.FleetManage)
  @ApiOperation({ summary: 'Update a bus (requires fleet.manage).' })
  @ApiParam({ name: 'busId', description: 'Bus id within the company.' })
  @ApiOkResponse({ type: BusResponseDto })
  @ApiNotFoundResponse({ description: 'No such bus in this company.' })
  @ApiConflictResponse({
    description: 'Duplicate plate number, or the seat layout does not exist.',
  })
  async update(
    @Param('companyId') companyId: string,
    @Param('busId') busId: string,
    @Body() body: UpdateBusDto,
  ): Promise<BusResponseDto> {
    const bus = await this.buses.updateBus(companyId, busId, body.toDomain());
    return BusResponseDto.from(bus);
  }

  @Post(':busId/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.FleetManage)
  @ApiOperation({ summary: 'Activate a bus (requires fleet.manage).' })
  @ApiParam({ name: 'busId', description: 'Bus id within the company.' })
  @ApiOkResponse({ type: BusResponseDto })
  @ApiNotFoundResponse({ description: 'No such bus in this company.' })
  @ApiConflictResponse({ description: 'The bus is already active.' })
  async activate(
    @Param('companyId') companyId: string,
    @Param('busId') busId: string,
  ): Promise<BusResponseDto> {
    const bus = await this.buses.setBusActive(companyId, busId, true);
    return BusResponseDto.from(bus);
  }

  @Post(':busId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.FleetManage)
  @ApiOperation({ summary: 'Deactivate a bus (requires fleet.manage).' })
  @ApiParam({ name: 'busId', description: 'Bus id within the company.' })
  @ApiOkResponse({ type: BusResponseDto })
  @ApiNotFoundResponse({ description: 'No such bus in this company.' })
  @ApiConflictResponse({ description: 'The bus is already inactive.' })
  async deactivate(
    @Param('companyId') companyId: string,
    @Param('busId') busId: string,
  ): Promise<BusResponseDto> {
    const bus = await this.buses.setBusActive(companyId, busId, false);
    return BusResponseDto.from(bus);
  }
}
