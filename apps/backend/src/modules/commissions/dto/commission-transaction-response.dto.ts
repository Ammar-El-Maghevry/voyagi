import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommissionStatus } from '../commission-status';
import type { CommissionTransaction } from '../commission.types';

export class CommissionTransactionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() agentMembershipId!: string;
  @ApiProperty() bookingId!: string;
  @ApiProperty() companyId!: string;
  @ApiProperty() commissionRate!: string;
  @ApiProperty() baseAmount!: string;
  @ApiProperty() commissionAmount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: CommissionStatus }) status!: CommissionStatus;
  @ApiPropertyOptional({ format: 'date-time' }) earnedAt?: string;
  @ApiPropertyOptional({ format: 'date-time' }) paidAt?: string;
  @ApiPropertyOptional({ format: 'date-time' }) cancelledAt?: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;

  static from(transaction: CommissionTransaction): CommissionTransactionResponseDto {
    return {
      id: transaction.id,
      agentMembershipId: transaction.agentMembershipId,
      bookingId: transaction.bookingId,
      companyId: transaction.companyId,
      commissionRate: transaction.commissionRate,
      baseAmount: transaction.baseAmount,
      commissionAmount: transaction.commissionAmount,
      currency: transaction.currency,
      status: transaction.status,
      earnedAt: transaction.earnedAt?.toISOString(),
      paidAt: transaction.paidAt?.toISOString(),
      cancelledAt: transaction.cancelledAt?.toISOString(),
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString(),
    };
  }
}
