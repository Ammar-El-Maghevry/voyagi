import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

/**
 * A station addressed by id is not present (or is inactive/soft-deleted).
 * Scoped-to-not-found by design: it never distinguishes those cases, so it is
 * not an existence oracle over the reference catalog.
 */
export class StationNotFoundError extends HttpException {
  constructor() {
    super(
      {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'The requested station was not found.',
      },
      HttpStatus.NOT_FOUND,
    );
  }
}
