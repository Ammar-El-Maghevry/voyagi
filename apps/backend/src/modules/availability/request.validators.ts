import { registerDecorator, type ValidationOptions } from 'class-validator';

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const MAX_BIGINT = 9223372036854775807n;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isPositiveBigInt(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    POSITIVE_INTEGER_PATTERN.test(value) &&
    BigInt(value) <= MAX_BIGINT
  );
}

export function isYyyyMmDd(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year === 0) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
}

export function IsPositiveBigInt(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isPositiveBigInt',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: validationOptions,
      validator: { validate: isPositiveBigInt },
    });
  };
}

export function IsYyyyMmDd(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isYyyyMmDd',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: validationOptions,
      validator: { validate: isYyyyMmDd },
    });
  };
}
