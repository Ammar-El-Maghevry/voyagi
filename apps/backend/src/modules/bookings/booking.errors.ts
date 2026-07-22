import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

class BookingHttpError extends HttpException {
  constructor(code: ErrorCode, message: string, status: HttpStatus) {
    super({ code, message }, status);
  }
}

export class TripNotBookableError extends BookingHttpError {
  constructor() {
    super(ErrorCode.TRIP_NOT_BOOKABLE, 'The trip is not open for booking.', HttpStatus.CONFLICT);
  }
}

export class InvalidSeatSelectionError extends BookingHttpError {
  constructor(message = 'One or more selected seats are invalid.') {
    super(ErrorCode.INVALID_SEAT_SELECTION, message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class SeatAlreadyReservedError extends BookingHttpError {
  constructor() {
    super(ErrorCode.SEAT_ALREADY_RESERVED, 'One or more selected seats are no longer available.', HttpStatus.CONFLICT);
  }
}

export class IdempotencyConflictError extends BookingHttpError {
  constructor() {
    super(ErrorCode.IDEMPOTENCY_CONFLICT, 'The idempotency key was already used with a different request.', HttpStatus.CONFLICT);
  }
}

export class BookingNotFoundError extends BookingHttpError {
  constructor() {
    super(ErrorCode.RESOURCE_NOT_FOUND, 'The requested booking was not found.', HttpStatus.NOT_FOUND);
  }
}

export class BookingNotCancellableError extends BookingHttpError {
  constructor() {
    super(ErrorCode.BOOKING_NOT_CANCELLABLE, 'The booking is not in a cancellable state.', HttpStatus.CONFLICT);
  }
}

export class BookingBranchForbiddenError extends BookingHttpError {
  constructor() {
    super(ErrorCode.FORBIDDEN, 'The booking action is not allowed in this branch.', HttpStatus.FORBIDDEN);
  }
}

export class InvalidIdempotencyKeyError extends BookingHttpError {
  constructor() {
    super(ErrorCode.VALIDATION_ERROR, 'A valid Idempotency-Key header is required.', HttpStatus.BAD_REQUEST);
  }
}

export class BookingReferenceUnavailableError extends BookingHttpError {
  constructor() {
    super(
      ErrorCode.DEPENDENCY_FAILURE,
      'A booking reference could not be allocated. Please retry.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
