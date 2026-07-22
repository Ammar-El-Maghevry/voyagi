import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

class PaymentHttpError extends HttpException {
  constructor(code: ErrorCode, message: string, status: HttpStatus) {
    super({ code, message }, status);
  }
}

/** Safely hides a payment that does not exist or the caller cannot reach. */
export class PaymentNotFoundError extends PaymentHttpError {
  constructor() {
    super(
      ErrorCode.RESOURCE_NOT_FOUND,
      'The requested payment was not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}

/** Safely hides a booking that does not exist or the caller cannot reach. */
export class PaymentBookingNotFoundError extends PaymentHttpError {
  constructor() {
    super(
      ErrorCode.RESOURCE_NOT_FOUND,
      'The requested booking was not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}

/** The booking is not in a state that accepts a new payment (or has expired). */
export class BookingNotPayableError extends PaymentHttpError {
  constructor(message = 'The booking is not open for payment.') {
    super(ErrorCode.BOOKING_NOT_PAYABLE, message, HttpStatus.CONFLICT);
  }
}

/** A successful payment already settles the booking. */
export class PaymentAlreadySettledError extends PaymentHttpError {
  constructor() {
    super(
      ErrorCode.PAYMENT_ALREADY_SETTLED,
      'The booking has already been paid.',
      HttpStatus.CONFLICT,
    );
  }
}

/** The payment is not in a state that can be confirmed. */
export class PaymentNotConfirmableError extends PaymentHttpError {
  constructor() {
    super(
      ErrorCode.PAYMENT_NOT_CONFIRMABLE,
      'The payment is not in a confirmable state.',
      HttpStatus.CONFLICT,
    );
  }
}

/** The payment is not in a state that can be refunded. */
export class PaymentNotRefundableError extends PaymentHttpError {
  constructor() {
    super(
      ErrorCode.PAYMENT_NOT_REFUNDABLE,
      'The payment is not in a refundable state.',
      HttpStatus.CONFLICT,
    );
  }
}

/** The requested method cannot be used for this operation (e.g. confirming a non-cash payment). */
export class PaymentMethodNotAllowedError extends PaymentHttpError {
  constructor(message = 'The payment method is not allowed for this operation.') {
    super(ErrorCode.PAYMENT_METHOD_NOT_ALLOWED, message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** The provided Idempotency-Key header is missing or malformed. */
export class InvalidIdempotencyKeyError extends PaymentHttpError {
  constructor() {
    super(
      ErrorCode.VALIDATION_ERROR,
      'A valid Idempotency-Key header is required.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** The idempotency key was reused with a semantically different request. */
export class PaymentIdempotencyConflictError extends PaymentHttpError {
  constructor() {
    super(
      ErrorCode.IDEMPOTENCY_CONFLICT,
      'The idempotency key was already used with a different request.',
      HttpStatus.CONFLICT,
    );
  }
}

/** The caller lacks the permission/branch entitlement for this payment action. */
export class PaymentForbiddenError extends PaymentHttpError {
  constructor() {
    super(
      ErrorCode.FORBIDDEN,
      'The payment action is not allowed in this branch.',
      HttpStatus.FORBIDDEN,
    );
  }
}

/** A webhook payload failed signature verification. Deliberately generic. */
export class WebhookSignatureInvalidError extends PaymentHttpError {
  constructor() {
    super(
      ErrorCode.WEBHOOK_SIGNATURE_INVALID,
      'The webhook signature could not be verified.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** A unique internal payment reference could not be allocated. */
export class PaymentReferenceUnavailableError extends PaymentHttpError {
  constructor() {
    super(
      ErrorCode.DEPENDENCY_FAILURE,
      'A payment reference could not be allocated. Please retry.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
