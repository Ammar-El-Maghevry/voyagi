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
import { CreateStaffMemberDto } from './dto/create-staff-member.dto';
import { StaffMemberResponseDto } from './dto/staff-member-response.dto';
import { UpdateStaffMemberDto } from './dto/update-staff-member.dto';
import { StaffService } from './staff.service';

/**
 * Staff-member endpoints, scoped to `:companyId` (the tenant target).
 *
 * Staff are company-scoped: the guard enforces `staff.read` for reads and the
 * company-wide `staff.manage` for writes; every query is filtered by
 * `companyId`, so no other company's staff are ever returned or mutated. There
 * is no branch dimension.
 */
@ApiTags('staff')
@ApiBearerAuth('bearer')
@ApiParam({ name: 'companyId', description: 'Target company (tenant) id.' })
@ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid credentials.' })
@ApiForbiddenResponse({
  description: 'No active membership in the company, or the required permission is missing.',
})
@Controller({ path: 'companies/:companyId/staff-members', version: '1' })
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermissions(Permission.StaffRead)
  @ApiOperation({ summary: 'List staff members within a company.' })
  @ApiOkResponse({ type: StaffMemberResponseDto, isArray: true })
  async list(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<StaffMemberResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.staff.listStaff(companyId, pagination);
    return new CollectionResult(
      page.items.map(StaffMemberResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Get(':staffMemberId')
  @RequirePermissions(Permission.StaffRead)
  @ApiOperation({ summary: 'Read a single staff member within a company.' })
  @ApiParam({ name: 'staffMemberId', description: 'Staff member id within the company.' })
  @ApiOkResponse({ type: StaffMemberResponseDto })
  @ApiNotFoundResponse({ description: 'No such staff member in this company.' })
  async getOne(
    @Param('companyId') companyId: string,
    @Param('staffMemberId') staffMemberId: string,
  ): Promise<StaffMemberResponseDto> {
    const staffMember = await this.staff.getStaffMember(companyId, staffMemberId);
    return StaffMemberResponseDto.from(staffMember);
  }

  @Post()
  @RequirePermissions(Permission.StaffManage)
  @ApiOperation({ summary: 'Create a staff member (requires staff.manage).' })
  @ApiCreatedResponse({ type: StaffMemberResponseDto })
  async create(
    @Param('companyId') companyId: string,
    @Body() body: CreateStaffMemberDto,
  ): Promise<StaffMemberResponseDto> {
    const staffMember = await this.staff.createStaffMember(
      companyId,
      body.toDomain(),
    );
    return StaffMemberResponseDto.from(staffMember);
  }

  @Patch(':staffMemberId')
  @RequirePermissions(Permission.StaffManage)
  @ApiOperation({ summary: 'Update a staff member (requires staff.manage).' })
  @ApiParam({ name: 'staffMemberId', description: 'Staff member id within the company.' })
  @ApiOkResponse({ type: StaffMemberResponseDto })
  @ApiNotFoundResponse({ description: 'No such staff member in this company.' })
  async update(
    @Param('companyId') companyId: string,
    @Param('staffMemberId') staffMemberId: string,
    @Body() body: UpdateStaffMemberDto,
  ): Promise<StaffMemberResponseDto> {
    const staffMember = await this.staff.updateStaffMember(
      companyId,
      staffMemberId,
      body.toDomain(),
    );
    return StaffMemberResponseDto.from(staffMember);
  }

  @Post(':staffMemberId/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.StaffManage)
  @ApiOperation({ summary: 'Activate a staff member (requires staff.manage).' })
  @ApiParam({ name: 'staffMemberId', description: 'Staff member id within the company.' })
  @ApiOkResponse({ type: StaffMemberResponseDto })
  @ApiNotFoundResponse({ description: 'No such staff member in this company.' })
  @ApiConflictResponse({ description: 'The staff member is already active.' })
  async activate(
    @Param('companyId') companyId: string,
    @Param('staffMemberId') staffMemberId: string,
  ): Promise<StaffMemberResponseDto> {
    const staffMember = await this.staff.setStaffMemberActive(
      companyId,
      staffMemberId,
      true,
    );
    return StaffMemberResponseDto.from(staffMember);
  }

  @Post(':staffMemberId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.StaffManage)
  @ApiOperation({ summary: 'Deactivate a staff member (requires staff.manage).' })
  @ApiParam({ name: 'staffMemberId', description: 'Staff member id within the company.' })
  @ApiOkResponse({ type: StaffMemberResponseDto })
  @ApiNotFoundResponse({ description: 'No such staff member in this company.' })
  @ApiConflictResponse({ description: 'The staff member is already inactive.' })
  async deactivate(
    @Param('companyId') companyId: string,
    @Param('staffMemberId') staffMemberId: string,
  ): Promise<StaffMemberResponseDto> {
    const staffMember = await this.staff.setStaffMemberActive(
      companyId,
      staffMemberId,
      false,
    );
    return StaffMemberResponseDto.from(staffMember);
  }
}
