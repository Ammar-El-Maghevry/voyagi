import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/pagination/pagination';
import { CollectionResult } from '../../common/pagination/collection-result';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { CompanyMembershipSummaryDto } from './dto/company-membership-summary.dto';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { IdentityService } from './identity.service';

/**
 * Self-service profile and "my companies" endpoints. Protected by the global
 * authentication guard; each operation acts only on the verified caller's own
 * data (the auth user id comes from the principal, never from the request body
 * or a client-supplied id).
 */
@ApiTags('identity')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Missing, expired, or invalid credentials.' })
@Controller({ path: 'profiles', version: '1' })
export class ProfilesController {
  constructor(private readonly identity: IdentityService) {}

  @Get('me')
  @ApiOperation({ summary: "Return the authenticated user's backend profile." })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiNotFoundResponse({ description: 'No profile exists for the authenticated user.' })
  async me(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<ProfileResponseDto> {
    const profile = await this.identity.getProfile(principal.userId);
    return ProfileResponseDto.from(profile);
  }

  @Patch('me')
  @ApiOperation({ summary: "Update the authenticated user's own profile fields." })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiNotFoundResponse({ description: 'No profile exists for the authenticated user.' })
  async updateMe(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    const profile = await this.identity.updateProfile(
      principal.userId,
      body.toDomain(),
    );
    return ProfileResponseDto.from(profile);
  }

  @Get('me/companies')
  @ApiOperation({ summary: 'List the companies the authenticated user belongs to.' })
  @ApiOkResponse({ type: CompanyMembershipSummaryDto, isArray: true })
  async myCompanies(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionResult<CompanyMembershipSummaryDto>> {
    const pagination = resolvePagination(query);
    const page = await this.identity.listMyCompanies(
      principal.userId,
      pagination,
    );
    return new CollectionResult(
      page.items.map(CompanyMembershipSummaryDto.from),
      buildPaginationMeta(pagination.page, pagination.pageSize, page.total),
    );
  }
}
