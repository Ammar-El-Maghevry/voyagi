import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CollectionResult } from '../../common/pagination/collection-result';
import { buildPaginationMeta, resolvePagination } from '../../common/pagination/pagination';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { COMPANY_ID_HEADER } from '../authorization/company-id.util';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permission } from '../authorization/permission.enum';
import { CreateMaintenanceRecordDto } from './dto/create-maintenance-record.dto';
import { MaintenanceRecordResponseDto } from './dto/maintenance-record-response.dto';
import { UpdateMaintenanceRecordDto } from './dto/update-maintenance-record.dto';
import { MaintenanceService } from './maintenance.service';
import { getCorrelationId } from '../../common/request-context/correlation-id.util';
import { getRequestId } from '../../common/request-context/request-id.util';

@ApiTags('maintenance')
@ApiBearerAuth('bearer')
@ApiHeader({ name: 'X-Company-Id', required: true, description: 'Target company id.' })
@ApiUnauthorizedResponse({ description: 'Authentication is required.' })
@ApiForbiddenResponse({ description: 'Company membership or permission is missing.' })
@Controller({ path: 'maintenance-records', version: '1' })
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @RequirePermissions(Permission.MaintenanceRead)
  @ApiOperation({ summary: 'List maintenance records for X-Company-Id.' })
  @ApiOkResponse({ type: MaintenanceRecordResponseDto, isArray: true })
  async list(
    @Headers(COMPANY_ID_HEADER) companyId: string | undefined,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<MaintenanceRecordResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.maintenance.listRecords(companyId, pagination);
    return new CollectionResult(
      page.items.map(MaintenanceRecordResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Post()
  @RequirePermissions(Permission.MaintenanceManage)
  @ApiOperation({ summary: 'Schedule maintenance using its planned interval.' })
  @ApiCreatedResponse({ type: MaintenanceRecordResponseDto })
  @ApiConflictResponse({ description: 'Active maintenance or a live trip conflicts.' })
  @ApiUnprocessableEntityResponse({ description: 'Bus or planned interval is invalid.' })
  async create(
    @Headers(COMPANY_ID_HEADER) companyId: string | undefined,
    @Body() body: CreateMaintenanceRecordDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Req() request: Request,
  ): Promise<MaintenanceRecordResponseDto> {
    return MaintenanceRecordResponseDto.from(
      await this.maintenance.createRecord(companyId, body.toDomain(), principal.userId, {
        requestId: getRequestId(request),
        correlationId: getCorrelationId(request),
      }),
    );
  }

  @Patch(':recordId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.MaintenanceManage)
  @ApiOperation({ summary: 'Start, complete, or cancel a maintenance record.' })
  @ApiParam({ name: 'recordId', description: 'Maintenance record id.' })
  @ApiOkResponse({ type: MaintenanceRecordResponseDto })
  @ApiNotFoundResponse({ description: 'No record exists in X-Company-Id.' })
  @ApiConflictResponse({ description: 'The lifecycle action is not currently allowed.' })
  async update(
    @Headers(COMPANY_ID_HEADER) companyId: string | undefined,
    @Param('recordId') recordId: string,
    @Body() body: UpdateMaintenanceRecordDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Req() request: Request,
  ): Promise<MaintenanceRecordResponseDto> {
    return MaintenanceRecordResponseDto.from(
      await this.maintenance.applyAction(companyId, recordId, body.action, principal.userId, {
        requestId: getRequestId(request),
        correlationId: getCorrelationId(request),
      }),
    );
  }
}
