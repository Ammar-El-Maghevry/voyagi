import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

/**
 * A route addressed by id is not present in the requested company.
 * Scoped-to-not-found by design: it never distinguishes "belongs to another
 * company" or "soft-deleted" from "does not exist", so it is not a cross-tenant
 * existence oracle.
 */
export class RouteNotFoundError extends HttpException {
  constructor() {
    super(
      {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'The requested route was not found.',
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * An activation transition was requested that does not apply — activating an
 * already-active route, or deactivating an already-inactive one.
 */
export class RouteStateConflictError extends HttpException {
  constructor(target: boolean) {
    super(
      {
        code: ErrorCode.CONFLICT,
        message: `The route is already ${target ? 'active' : 'inactive'}.`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * A referenced station is missing or inactive, so it cannot anchor a route.
 * Reported as a domain-invariant violation (`422`), distinct from a malformed
 * id (`400`) or a tenant-scoped not-found (`404`).
 */
export class RouteStationInvalidError extends HttpException {
  constructor() {
    super(
      {
        code: ErrorCode.BUSINESS_RULE_VIOLATION,
        message:
          'Origin and destination must be distinct, existing, active stations.',
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
