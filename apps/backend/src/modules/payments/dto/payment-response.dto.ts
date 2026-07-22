import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Payment } from '../payment.types';

/**
 * Client-facing payment view. Deliberately excludes any raw provider payload and
 * the confirming actor id. `providerReference` and `internalReference` are
 * correlation identifiers (not secrets) that clients use to match settlements.
 */
export class PaymentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() bookingId!: string;
  @ApiProperty() companyId!: string;
  @ApiProperty() method!: string;
  @ApiProperty() status!: string;
  @ApiProperty() amount!: string;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional() providerReference?: string;
  @ApiProperty() internalReference!: string;
  @ApiPropertyOptional({ format: 'date-time' }) paidAt?: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;

  static from(payment: Payment): PaymentResponseDto {
    return {
      id: payment.id,
      bookingId: payment.bookingId,
      companyId: payment.companyId,
      method: payment.method,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      providerReference: payment.providerReference,
      internalReference: payment.internalReference,
      paidAt: payment.paidAt?.toISOString(),
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    };
  }
}
