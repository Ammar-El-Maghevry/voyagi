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
import { AuthorizationCtx } from '../authorization/decorators/authorization-context.decorator';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import type { AuthorizationContext } from '../authorization/authorization-context';
import { Permission } from '../authorization/permission.enum';
import { BranchesService } from './branches.service';
import { BranchResponseDto } from './dto/branch-response.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

/**
 * Branch endpoints, scoped to `:companyId` (the tenant target).
 *
 * The global authorization guard resolves the caller's context for the company
 * and enforces the declared permission before any handler runs: reads require
 * `branches.read`, writes require the company-wide `branches.manage`. Reads are
 * additionally narrowed to the caller's readable branches inside the service
 * (branch-restricted members see only their branch); every query is scoped by
 * `companyId`, so no other company's branches are ever returned or mutated.
 */
@ApiTags('branches')
@ApiBearerAuth('bearer')
@ApiParam({ name: 'companyId', description: 'Target company (tenant) id.' })
@ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid credentials.' })
@ApiForbiddenResponse({
  description: 'No active membership in the company, or the required permission is missing.',
})
@Controller({ path: 'companies/:companyId/branches', version: '1' })
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermissions(Permission.BranchesRead)
  @ApiOperation({ summary: 'List branches the caller may read within a company.' })
  @ApiOkResponse({ type: BranchResponseDto, isArray: true })
  async list(
    @AuthorizationCtx() context: AuthorizationContext,
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<BranchResponseDto>> {
    const pagination = resolvePagination(query);
    const page = await this.branches.listBranches(
      context.userId,
      companyId,
      pagination,
    );
    return new CollectionResult(
      page.items.map(BranchResponseDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }

  @Get(':branchId')
  @RequirePermissions(Permission.BranchesRead)
  @ApiOperation({ summary: 'Read a single branch within a company.' })
  @ApiParam({ name: 'branchId', description: 'Branch id within the company.' })
  @ApiOkResponse({ type: BranchResponseDto })
  @ApiNotFoundResponse({ description: 'No such branch in this company, or not visible to the caller.' })
  async getOne(
    @AuthorizationCtx() context: AuthorizationContext,
    @Param('companyId') companyId: string,
    @Param('branchId') branchId: string,
  ): Promise<BranchResponseDto> {
    const branch = await this.branches.getBranch(
      context.userId,
      companyId,
      branchId,
    );
    return BranchResponseDto.from(branch);
  }

  @Post()
  @RequirePermissions(Permission.BranchesManage)
  @ApiOperation({ summary: 'Create a branch (requires branches.manage).' })
  @ApiCreatedResponse({ type: BranchResponseDto })
  @ApiConflictResponse({ description: 'A branch with the same names already exists, or the city is invalid.' })
  async create(
    @Param('companyId') companyId: string,
    @Body() body: CreateBranchDto,
  ): Promise<BranchResponseDto> {
    const branch = await this.branches.createBranch(companyId, body.toDomain());
    return BranchResponseDto.from(branch);
  }

  @Patch(':branchId')
  @RequirePermissions(Permission.BranchesManage)
  @ApiOperation({ summary: 'Update a branch’s descriptive fields (requires branches.manage).' })
  @ApiParam({ name: 'branchId', description: 'Branch id within the company.' })
  @ApiOkResponse({ type: BranchResponseDto })
  @ApiNotFoundResponse({ description: 'No such branch in this company.' })
  @ApiConflictResponse({ description: 'A branch with the same names already exists, or the city is invalid.' })
  async update(
    @Param('companyId') companyId: string,
    @Param('branchId') branchId: string,
    @Body() body: UpdateBranchDto,
  ): Promise<BranchResponseDto> {
    const branch = await this.branches.updateBranch(
      companyId,
      branchId,
      body.toDomain(),
    );
    return BranchResponseDto.from(branch);
  }

  @Post(':branchId/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.BranchesManage)
  @ApiOperation({ summary: 'Activate a branch (requires branches.manage).' })
  @ApiParam({ name: 'branchId', description: 'Branch id within the company.' })
  @ApiOkResponse({ type: BranchResponseDto })
  @ApiNotFoundResponse({ description: 'No such branch in this company.' })
  @ApiConflictResponse({ description: 'The branch is already active.' })
  async activate(
    @Param('companyId') companyId: string,
    @Param('branchId') branchId: string,
  ): Promise<BranchResponseDto> {
    const branch = await this.branches.setBranchActive(companyId, branchId, true);
    return BranchResponseDto.from(branch);
  }

  @Post(':branchId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.BranchesManage)
  @ApiOperation({ summary: 'Deactivate a branch (requires branches.manage).' })
  @ApiParam({ name: 'branchId', description: 'Branch id within the company.' })
  @ApiOkResponse({ type: BranchResponseDto })
  @ApiNotFoundResponse({ description: 'No such branch in this company.' })
  @ApiConflictResponse({ description: 'The branch is already inactive.' })
  async deactivate(
    @Param('companyId') companyId: string,
    @Param('branchId') branchId: string,
  ): Promise<BranchResponseDto> {
    const branch = await this.branches.setBranchActive(companyId, branchId, false);
    return BranchResponseDto.from(branch);
  }
}
