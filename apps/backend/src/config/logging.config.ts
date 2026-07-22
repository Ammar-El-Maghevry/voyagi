import { registerAs } from '@nestjs/config';
import { parseBoolean, parseInteger } from './parse.util';

/**
 * Structured logging configuration namespace.
 */
export const loggingConfig = registerAs('logging', () => {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
    // Human-readable pretty printing is only appropriate outside production.
    pretty: parseBoolean(process.env.LOG_PRETTY, !isProduction),
    // Log complete requests exceeding this duration; zero logs every request.
    slowRequestMs: parseInteger(process.env.LOG_SLOW_REQUEST_MS, 1000),
  };
});
