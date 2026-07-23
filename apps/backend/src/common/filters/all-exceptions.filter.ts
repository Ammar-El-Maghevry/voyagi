import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode } from '../errors/error-code.enum';
import type {
  ApiErrorBody,
  ApiErrorResponse,
} from '../interfaces/api-response.interface';
import { getRequestId } from '../request-context/request-id.util';
import { ValidationException } from '../validation/validation.exception';

/** Internal, non-exposed representation of a mapped exception. */
interface MappedException {
  status: number;
  body: ApiErrorBody;
  /** Original error, retained for server-side logging only. */
  cause: unknown;
}

/**
 * Global exception filter that renders every failure into the standard error
 * envelope. It never leaks stack traces, SQL, or raw internal exceptions to
 * clients; internal failures are logged server-side and returned as a generic,
 * safe message.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const requestId = getRequestId(request);
    const { status, body, cause } = this.mapException(exception);

    this.log(status, body, cause, request, requestId);

    const payload: ApiErrorResponse = {
      success: false,
      error: body,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    };

    response.status(status).json(payload);
  }

  private mapException(exception: unknown): MappedException {
    if (exception instanceof ValidationException) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'The request contains invalid fields.',
          details: { fields: exception.fields },
        },
        cause: exception,
      };
    }

    if (exception instanceof HttpException) {
      return this.mapHttpException(exception);
    }

    // Body-parser style client errors (oversized/malformed body) are not Nest
    // HttpExceptions; map them to their stable 4xx code instead of a generic 500.
    const bodyError = this.mapBodyParserError(exception);
    if (bodyError) {
      return bodyError;
    }

    // Unknown/unexpected error: never expose its contents.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An unexpected error occurred.',
      },
      cause: exception,
    };
  }

  /**
   * Recognize safe-to-expose client errors thrown by the body parser (e.g.
   * `PayloadTooLargeError` / malformed JSON), which carry a numeric status and
   * `expose: true` but are not {@link HttpException}s. The client sees only a
   * stable code and a generic message — never the parser's internals.
   */
  private mapBodyParserError(exception: unknown): MappedException | undefined {
    if (typeof exception !== 'object' || exception === null) {
      return undefined;
    }
    const error = exception as {
      status?: unknown;
      statusCode?: unknown;
      expose?: unknown;
      type?: unknown;
    };
    const status =
      typeof error.status === 'number'
        ? error.status
        : typeof error.statusCode === 'number'
          ? error.statusCode
          : undefined;
    if (status === undefined || status < 400 || status >= 500) {
      return undefined;
    }
    if (error.expose !== true && typeof error.type !== 'string') {
      return undefined;
    }
    const message =
      status === HttpStatus.PAYLOAD_TOO_LARGE
        ? 'The request payload is too large.'
        : status === HttpStatus.BAD_REQUEST
          ? 'The request body could not be parsed.'
          : 'The request could not be processed.';
    return {
      status,
      body: { code: this.mapStatusToCode(status), message },
      cause: exception,
    };
  }

  private mapHttpException(exception: HttpException): MappedException {
    const status = exception.getStatus();
    const response = exception.getResponse();

    // Default to a stable, status-derived code; an exception may override it
    // with an explicit stable `code` in its response body (e.g. auth errors
    // distinguishing TOKEN_EXPIRED from TOKEN_INVALID).
    let code: string = this.mapStatusToCode(status);
    // Prefer a developer-authored message; fall back to a safe generic one.
    let message = exception.message;
    let details: Record<string, unknown> | undefined;

    if (typeof response === 'object' && response !== null) {
      const record = response as Record<string, unknown>;
      if (typeof record.code === 'string' && record.code.length > 0) {
        code = record.code;
      }
      if (typeof record.message === 'string') {
        message = record.message;
      } else if (Array.isArray(record.message)) {
        // Non-DTO validation messages arriving as an array.
        details = { messages: record.message };
        message = 'The request could not be processed.';
      }
    }

    return {
      status,
      body: { code, message, ...(details ? { details } : {}) },
      cause: exception,
    };
  }

  private mapStatusToCode(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.RESOURCE_NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ErrorCode.BUSINESS_RULE_VIOLATION;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMIT_EXCEEDED;
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return ErrorCode.PAYLOAD_TOO_LARGE;
      case HttpStatus.BAD_GATEWAY:
      case HttpStatus.SERVICE_UNAVAILABLE:
      case HttpStatus.GATEWAY_TIMEOUT:
        return ErrorCode.DEPENDENCY_FAILURE;
      default:
        return status >= HttpStatus.INTERNAL_SERVER_ERROR
          ? ErrorCode.INTERNAL_ERROR
          : ErrorCode.BUSINESS_RULE_VIOLATION;
    }
  }

  private log(
    status: number,
    body: ApiErrorBody,
    cause: unknown,
    request: Request,
    requestId: string,
  ): void {
    const context = {
      requestId,
      method: request.method,
      path: request.originalUrl,
      status,
      errorCode: body.code,
    };

    // Server errors are logged with the stack for diagnosis; client errors are
    // expected and logged at a lower level without noisy stack traces.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const stack = cause instanceof Error ? cause.stack : undefined;
      this.logger.error(context, stack);
    } else {
      this.logger.warn(context);
    }
  }
}
