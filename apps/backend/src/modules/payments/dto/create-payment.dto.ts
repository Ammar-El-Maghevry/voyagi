import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID } from 'class-validator';
import { type CreatePaymentInput, PaymentMethod } from '../payment.types';

export class CreatePaymentDto implements CreatePaymentInput {
  @ApiProperty({ format: 'uuid', description: 'The booking this payment settles.' })
  @IsUUID()
  bookingId!: string;

  @ApiProperty({ enum: PaymentMethod, description: 'Tender used for the payment.' })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  toDomain(): CreatePaymentInput {
    return { bookingId: this.bookingId, method: this.method };
  }
}
