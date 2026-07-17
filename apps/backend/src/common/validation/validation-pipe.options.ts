import { ValidationPipeOptions } from '@nestjs/common';
import { validationExceptionFactory } from './validation-exception.factory';

/**
 * Global validation policy applied to every request DTO.
 *
 * - `whitelist`: strip properties without validation decorators;
 * - `forbidNonWhitelisted`: reject requests that send unknown properties;
 * - `transform`: instantiate DTO classes and coerce primitive types.
 *
 * Exposed as a shared constant so the runtime pipe and its unit tests stay in
 * lockstep.
 */
export const validationPipeOptions: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: {
    enableImplicitConversion: true,
  },
  exceptionFactory: validationExceptionFactory,
};
