import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Branch } from '../branch.types';

/** A branch as returned by the branch endpoints. */
export class BranchResponseDto {
  @ApiProperty({ description: 'Branch id.' })
  id!: string;

  @ApiProperty({ description: 'Company id the branch belongs to.' })
  companyId!: string;

  @ApiProperty({ description: 'City id the branch is located in.' })
  cityId!: string;

  @ApiProperty({ description: 'Branch name (Arabic).' })
  nameAr!: string;

  @ApiProperty({ description: 'Branch name (French).' })
  nameFr!: string;

  @ApiPropertyOptional({ description: 'Contact phone, when set.' })
  phone?: string;

  @ApiProperty({ description: 'Whether the branch is active.' })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  static from(branch: Branch): BranchResponseDto {
    return {
      id: branch.id,
      companyId: branch.companyId,
      cityId: branch.cityId,
      nameAr: branch.nameAr,
      nameFr: branch.nameFr,
      phone: branch.phone,
      isActive: branch.isActive,
      createdAt: branch.createdAt.toISOString(),
      updatedAt: branch.updatedAt.toISOString(),
    };
  }
}
