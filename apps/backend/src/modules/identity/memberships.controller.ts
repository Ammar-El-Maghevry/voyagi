import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination/pagination';
import { CollectionResult } from '../../common/pagination/collection-result';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { Permission } from '../authorization/permission.enum';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { MembershipResponseDto } from './dto/membership-response.dto';
import { IdentityService } from './identity.service';

/**
 * Company membership listing/read endpoints, scoped to `:companyId`.
 *
 * The `:companyId` path parameter is the tenant target: the global authorization
 * guard resolves the caller's context for that company and enforces
 * `memberships.read`, so a caller with no active membership there is denied
 * (`403`) before any handler runs. Every query is additionally filtered by the
 * same `companyId`, so no other company's memberships are ever returned.
 */
@ApiTags('identity')
@ApiBearerAuth('bearer')
@ApiParam({ name: 'companyId', description: 'Target company (tenant) id.' })
@ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid credentials.' })
@ApiForbiddenResponse({
  description: 'No active membership in the company, or the memberships.read permission is missing.',
})
@RequirePermissions(Permission.MembershipsRead)
@Controller({ path: 'companies/:companyId/memberships', version: '1' })
export class MembershipsController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  @ApiOperation({ summary: 'List memberships within a company.' })
  @ApiOkResponse({ type: MembershipResponseDto, isArray: true })
  async list(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<MembershipResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.identity.listCompanyMemberships(
      companyId,
      pagination,
    );
    return new CollectionResult(
      page.items.map(MembershipResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Get(':membershipId')
  @ApiOperation({ summary: 'Read a single membership within a company.' })
  @ApiParam({ name: 'membershipId', description: 'Membership id within the company.' })
  @ApiOkResponse({ type: MembershipResponseDto })
  @ApiNotFoundResponse({ description: 'No such membership in this company.' })
  async getOne(
    @Param('companyId') companyId: string,
    @Param('membershipId') membershipId: string,
  ): Promise<MembershipResponseDto> {
    const membership = await this.identity.getCompanyMembership(
      companyId,
      membershipId,
    );
    return MembershipResponseDto.from(membership);
  }
}
