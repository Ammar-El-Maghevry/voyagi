import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

/**
 * A trip addressed by id is not present in the requested company.
 * Scoped-to-not-found by design, so it is not a cross-tenant existence oracle.
 */
export class TripNotFoundError extends HttpException {
  constructor() {
    super(
      { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'The requested trip was not found.' },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * A lifecycle action was requested from a status that does not allow it (e.g.
 * completing a `SCHEDULED` trip, or starting an already-`ONGOING` one). Also
 * covers a lost race where another writer moved the trip first.
 */
export class TripTransitionConflictError extends HttpException {
  constructor() {
    super(
      {
        code: ErrorCode.CONFLICT,
        message: 'The trip is not in a state that allows this action.',
      },
      HttpStatus.CONFLICT,
    );
  }
}

/** The supplied optimistic-lock version did not match the current row. */
export class TripVersionConflictError extends HttpException {
  constructor() {
    super(
      {
        code: ErrorCode.CONFLICT,
        message: 'The trip was modified by someone else; reload and retry.',
      },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * A referenced route or bus cannot anchor the trip — missing in the company,
 * inactive, or (for a bus) not operational. Reported as a domain-invariant
 * violation (`422`), distinct from a malformed id (`400`) or a scoped
 * not-found (`404`).
 */
export class TripAssociationInvalidError extends HttpException {
  constructor(message: string) {
    super(
      { code: ErrorCode.BUSINESS_RULE_VIOLATION, message },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
