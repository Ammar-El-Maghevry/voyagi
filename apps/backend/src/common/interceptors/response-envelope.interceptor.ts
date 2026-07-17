import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { ApiSuccessResponse } from '../interfaces/api-response.interface';
import { getRequestId } from '../request-context/request-id.util';

/** A value that already conforms to the success envelope shape. */
function isEnvelope(value: unknown): value is ApiSuccessResponse<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { success?: unknown }).success === true &&
    'data' in value
  );
}

/**
 * Wraps successful controller return values in the standard success envelope
 * so every endpoint responds consistently. Controllers therefore return plain
 * data and never construct the envelope themselves.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T>
  implements NestInterceptor<T, ApiSuccessResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    if (context.getType() !== 'http') {
      return next.handle() as Observable<ApiSuccessResponse<T>>;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const requestId = getRequestId(request);

    return next.handle().pipe(
      map((data) => {
        if (isEnvelope(data)) {
          return data as ApiSuccessResponse<T>;
        }
        return {
          success: true,
          data: (data ?? null) as T,
          requestId,
        };
      }),
    );
  }
}
