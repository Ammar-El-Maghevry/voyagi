import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-code.enum';

/**
 * A city addressed by id is not present (or is inactive). Scoped-to-not-found by
 * design: it never distinguishes "inactive" from "does not exist", so it is not
 * an existence oracle over the reference catalog.
 */
export class CityNotFoundError extends HttpException {
  constructor() {
    super(
      {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'The requested city was not found.',
      },
      HttpStatus.NOT_FOUND,
    );
  }
}
