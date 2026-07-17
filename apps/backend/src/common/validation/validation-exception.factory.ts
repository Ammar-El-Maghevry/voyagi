import { ValidationError } from '@nestjs/common';
import {
  ValidationException,
  ValidationFieldErrors,
} from './validation.exception';

/**
 * Flatten class-validator errors (including nested children) into a flat map
 * of `propertyPath -> messages`.
 */
function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ValidationFieldErrors {
  const fields: ValidationFieldErrors = {};

  for (const error of errors) {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;

    if (error.constraints) {
      fields[path] = Object.values(error.constraints);
    }

    if (error.children && error.children.length > 0) {
      Object.assign(fields, flattenValidationErrors(error.children, path));
    }
  }

  return fields;
}

/**
 * `ValidationPipe` exception factory that converts raw validation errors into
 * a typed {@link ValidationException} carrying structured field details.
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): ValidationException {
  return new ValidationException(flattenValidationErrors(errors));
}
