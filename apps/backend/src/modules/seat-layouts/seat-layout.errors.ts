import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

/**
 * A seat layout addressed by id is not present. Scoped-to-not-found by design,
 * so it is not an existence oracle over the template catalog.
 */
export class SeatLayoutNotFoundError extends HttpException {
  constructor() {
    super(
      {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'The requested seat layout was not found.',
      },
      HttpStatus.NOT_FOUND,
    );
  }
}
