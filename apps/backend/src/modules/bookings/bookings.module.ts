import { Module } from '@nestjs/common';
import {
  CancelBookingUseCase,
  CreateAgentBookingUseCase,
  CreatePassengerBookingUseCase,
  ExpireBookingUseCase,
  GetBookingUseCase,
  ListBookingEventsUseCase,
  ListBookingsUseCase,
} from './booking.use-cases';
import { CompanyBookingsController, PassengerBookingsController } from './bookings.controller';
import { BOOKINGS_REPOSITORY } from './bookings.repository';
import { BookingsService } from './bookings.service';
import { PostgresBookingsRepository } from './postgres-bookings.repository';
import { BookingReferenceGenerator } from './booking-reference.generator';

@Module({
  controllers: [PassengerBookingsController, CompanyBookingsController],
  providers: [
    { provide: BOOKINGS_REPOSITORY, useClass: PostgresBookingsRepository },
    BookingsService,
    BookingReferenceGenerator,
    CreatePassengerBookingUseCase,
    CreateAgentBookingUseCase,
    GetBookingUseCase,
    ListBookingsUseCase,
    CancelBookingUseCase,
    ExpireBookingUseCase,
    ListBookingEventsUseCase,
  ],
  exports: [BOOKINGS_REPOSITORY, ExpireBookingUseCase],
})
export class BookingsModule {}
