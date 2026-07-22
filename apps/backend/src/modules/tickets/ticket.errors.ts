import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

class TicketHttpError extends HttpException {
  constructor(code: ErrorCode, message: string, status: HttpStatus) {
    super({ code, message }, status);
  }
}

/** Safely hides a ticket that does not exist or the caller cannot reach. */
export class TicketNotFoundError extends TicketHttpError {
  constructor() {
    super(
      ErrorCode.RESOURCE_NOT_FOUND,
      'The requested ticket was not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}

/** Safely hides a booking that does not exist or the caller cannot reach. */
export class TicketBookingNotFoundError extends TicketHttpError {
  constructor() {
    super(
      ErrorCode.RESOURCE_NOT_FOUND,
      'The requested booking was not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}

/** The booking/payment state does not permit issuing tickets. */
export class TicketNotIssuableError extends TicketHttpError {
  constructor(message = 'Tickets cannot be issued for this booking yet.') {
    super(ErrorCode.TICKET_NOT_ISSUABLE, message, HttpStatus.CONFLICT);
  }
}

/** The ticket cannot be validated (revoked, refunded, already used, …). */
export class TicketNotValidatableError extends TicketHttpError {
  constructor(message = 'The ticket cannot be validated.') {
    super(ErrorCode.TICKET_NOT_VALIDATABLE, message, HttpStatus.CONFLICT);
  }
}

/** The caller lacks the permission/branch entitlement for this ticket action. */
export class TicketForbiddenError extends TicketHttpError {
  constructor() {
    super(
      ErrorCode.FORBIDDEN,
      'The ticket action is not allowed in this branch.',
      HttpStatus.FORBIDDEN,
    );
  }
}
