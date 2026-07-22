import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Booking, BookingEvent, BookingPassenger } from '../booking.types';

export class BookingPassengerResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() fullName!: string;
  @ApiPropertyOptional() phone?: string;
  @ApiPropertyOptional() documentNumber?: string;
  @ApiPropertyOptional() boardingStationId?: string;
  @ApiProperty() gender!: string;
  @ApiProperty() seatId!: string;

  static from(passenger: BookingPassenger): BookingPassengerResponseDto {
    return {
      id: passenger.id,
      fullName: passenger.fullName,
      phone: passenger.phone,
      documentNumber: passenger.documentNumber,
      boardingStationId: passenger.boardingStationId,
      gender: passenger.gender,
      seatId: passenger.seatId,
    };
  }
}

export class BookingResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() bookingReference!: string;
  @ApiProperty() tripId!: string;
  @ApiProperty() companyId!: string;
  @ApiPropertyOptional() branchId?: string;
  @ApiProperty() status!: string;
  @ApiProperty() unitPrice!: string;
  @ApiProperty() subtotalAmount!: string;
  @ApiProperty() serviceFeeAmount!: string;
  @ApiProperty() discountAmount!: string;
  @ApiProperty() totalAmount!: string;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional({ format: 'date-time' }) expiresAt?: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: BookingPassengerResponseDto, isArray: true })
  passengers!: BookingPassengerResponseDto[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;

  static from(booking: Booking): BookingResponseDto {
    return {
      id: booking.id,
      bookingReference: booking.bookingReference,
      tripId: booking.tripId,
      companyId: booking.companyId,
      branchId: booking.branchId,
      status: booking.status,
      unitPrice: booking.unitPrice,
      subtotalAmount: booking.subtotalAmount,
      serviceFeeAmount: booking.serviceFeeAmount,
      discountAmount: booking.discountAmount,
      totalAmount: booking.totalAmount,
      currency: booking.currency,
      expiresAt: booking.expiresAt?.toISOString(),
      version: booking.version,
      passengers: booking.passengers.map(BookingPassengerResponseDto.from),
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
    };
  }
}

export class BookingEventResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() eventType!: string;
  @ApiProperty({ format: 'date-time' }) eventTime!: string;

  static from(event: BookingEvent): BookingEventResponseDto {
    return { id: event.id, eventType: event.eventType, eventTime: event.eventTime.toISOString() };
  }
}
