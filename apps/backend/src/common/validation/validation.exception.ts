import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../errors/error-code.enum';

/** Per-field validation messages, keyed by (possibly nested) property path. */
export type ValidationFieldErrors = Record<string, string[]>;

/**
 * Raised by the global `ValidationPipe` when a request DTO fails validation.
 * Carries structured, per-field details that the exception filter renders into
 * the standard error envelope under `error.details.fields`.
 */
export class ValidationException extends HttpException {
  constructor(public readonly fields: ValidationFieldErrors) {
    super(
      {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'The request contains invalid fields.',
        fields,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
