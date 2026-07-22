import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

/** Hides whether a trip is absent or merely ineligible for public display. */
export class PublicTripNotFoundError extends HttpException {
  constructor() {
    super(
      {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'The requested trip was not found.',
      },
      HttpStatus.NOT_FOUND,
    );
  }
}
