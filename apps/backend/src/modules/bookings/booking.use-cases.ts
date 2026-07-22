import { Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import type {
  Booking,
  BookingEventPage,
  BookingPage,
  CreateBookingInput,
} from './booking.types';
import { BookingsService } from './bookings.service';

@Injectable()
export class CreatePassengerBookingUseCase {
  constructor(private readonly bookings: BookingsService) {}
  execute(actor: string, key: string | undefined, input: CreateBookingInput): Promise<Booking> {
    return this.bookings.createPassengerBooking(actor, key, input);
  }
}

@Injectable()
export class CreateAgentBookingUseCase {
  constructor(private readonly bookings: BookingsService) {}
  execute(
    actor: string,
    company: string,
    branch: string,
    key: string | undefined,
    input: CreateBookingInput,
  ): Promise<Booking> {
    return this.bookings.createAgentBooking(actor, company, branch, key, input);
  }
}

@Injectable()
export class GetBookingUseCase {
  constructor(private readonly bookings: BookingsService) {}
  owned(actor: string, bookingId: string): Promise<Booking> {
    return this.bookings.getOwnedBooking(actor, bookingId);
  }
  company(actor: string, companyId: string, bookingId: string): Promise<Booking> {
    return this.bookings.getCompanyBooking(actor, companyId, bookingId);
  }
}

@Injectable()
export class ListBookingsUseCase {
  constructor(private readonly bookings: BookingsService) {}
  owned(actor: string, pagination: ResolvedPagination): Promise<BookingPage> {
    return this.bookings.listOwnedBookings(actor, pagination);
  }
  company(actor: string, companyId: string, pagination: ResolvedPagination): Promise<BookingPage> {
    return this.bookings.listCompanyBookings(actor, companyId, pagination);
  }
}

@Injectable()
export class CancelBookingUseCase {
  constructor(private readonly bookings: BookingsService) {}
  owned(actor: string, bookingId: string): Promise<Booking> {
    return this.bookings.cancelOwnedBooking(actor, bookingId);
  }
  company(actor: string, companyId: string, bookingId: string): Promise<Booking> {
    return this.bookings.cancelCompanyBooking(actor, companyId, bookingId);
  }
}

@Injectable()
export class ExpireBookingUseCase {
  constructor(private readonly bookings: BookingsService) {}
  execute(companyId: string): Promise<number> {
    return this.bookings.expireBookings(companyId);
  }
}

@Injectable()
export class ListBookingEventsUseCase {
  constructor(private readonly bookings: BookingsService) {}
  owned(
    actor: string,
    bookingId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingEventPage> {
    return this.bookings.listOwnedEvents(actor, bookingId, pagination);
  }
  company(
    actor: string,
    companyId: string,
    bookingId: string,
    pagination: ResolvedPagination,
  ): Promise<BookingEventPage> {
    return this.bookings.listCompanyEvents(actor, companyId, bookingId, pagination);
  }
}
