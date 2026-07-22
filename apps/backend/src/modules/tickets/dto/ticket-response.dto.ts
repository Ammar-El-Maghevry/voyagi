import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { IssuedTicket, Ticket, TicketVerification } from '../ticket.types';

/**
 * Client-facing ticket view. Deliberately excludes `qr_token_hash` and any other
 * internal/secret material — only documented, non-sensitive fields are exposed.
 */
export class TicketResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() bookingId!: string;
  @ApiProperty() companyId!: string;
  @ApiProperty() passengerId!: string;
  @ApiProperty() seatReservationId!: string;
  @ApiProperty() seatNumber!: string;
  @ApiProperty() passengerName!: string;
  @ApiProperty() ticketNumber!: string;
  @ApiProperty({ enum: ['ISSUED', 'CHECKED_IN', 'CANCELLED'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) issuedAt!: string;
  @ApiPropertyOptional({ format: 'date-time' }) checkedInAt?: string;
  @ApiPropertyOptional({ format: 'date-time' }) cancelledAt?: string;

  static from(ticket: Ticket): TicketResponseDto {
    return {
      id: ticket.id,
      bookingId: ticket.bookingId,
      companyId: ticket.companyId,
      passengerId: ticket.passengerId,
      seatReservationId: ticket.seatReservationId,
      seatNumber: ticket.seatNumber,
      passengerName: ticket.passengerName,
      ticketNumber: ticket.ticketNumber,
      status: ticket.status,
      issuedAt: ticket.issuedAt.toISOString(),
      checkedInAt: ticket.checkedInAt?.toISOString(),
      cancelledAt: ticket.cancelledAt?.toISOString(),
    };
  }
}

/** Issuance view: carries the raw QR token exactly once, for freshly-issued tickets. */
export class IssuedTicketResponseDto extends TicketResponseDto {
  @ApiPropertyOptional({
    description: 'Raw QR token — returned only at issuance and never again.',
  })
  qrToken?: string;

  static fromIssued(ticket: IssuedTicket): IssuedTicketResponseDto {
    return { ...TicketResponseDto.from(ticket), qrToken: ticket.qrToken };
  }
}

/** Verification result for a presented QR token. */
export class TicketVerificationResponseDto {
  @ApiProperty() valid!: boolean;
  @ApiPropertyOptional() reason?: string;
  @ApiProperty({ type: TicketResponseDto }) ticket!: TicketResponseDto;

  static from(verification: TicketVerification): TicketVerificationResponseDto {
    return {
      valid: verification.valid,
      reason: verification.reason,
      ticket: TicketResponseDto.from(verification.ticket),
    };
  }
}
