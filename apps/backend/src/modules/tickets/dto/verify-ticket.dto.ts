import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class VerifyTicketDto {
  @ApiProperty({ description: 'Raw QR token scanned from a ticket.' })
  @Matches(/^[A-Za-z0-9_-]{16,512}$/)
  qrToken!: string;
}
