import { Controller, Get, Headers, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CollectionResult } from '../../common/pagination/collection-result';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination/pagination';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permission } from '../authorization/permission.enum';
import { AuditService } from './audit.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';

/** Read-only audit records for the company selected by the authorization guard. */
@ApiTags('audit')
@ApiBearerAuth('bearer')
@ApiHeader({
  name: 'X-Company-Id',
  required: true,
  description: 'Company scope, authorized by the global authorization guard.',
})
@ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid credentials.' })
@ApiForbiddenResponse({ description: 'Missing company access or audit.read permission.' })
@Controller({ path: 'audit-logs', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(Permission.AuditRead)
  @ApiOperation({ summary: 'List audit records for the selected company.' })
  @ApiOkResponse({ type: AuditLogResponseDto, isArray: true })
  async list(
    @Headers('x-company-id') companyId: string,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<CollectionResult<AuditLogResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.audit.listCompanyAuditLogs(companyId, pagination);
    return new CollectionResult(
      page.items.map(AuditLogResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }
}
