import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { CollectionResult } from '../pagination/collection-result';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

function httpContext(request: unknown): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function handlerOf<T>(value: T): CallHandler<T> {
  return { handle: () => of(value) };
}

describe('ResponseEnvelopeInterceptor', () => {
  const interceptor = new ResponseEnvelopeInterceptor();

  it('wraps plain data in the success envelope with the request id', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(
        httpContext({ id: 'req-1' }),
        handlerOf({ status: 'ok' }),
      ),
    );

    expect(result).toEqual({
      success: true,
      data: { status: 'ok' },
      requestId: 'req-1',
    });
    // A single resource never gains a pagination `meta` field (regression: the
    // CollectionResult change must not leak `meta` onto non-collection responses).
    expect(result).not.toHaveProperty('meta');
  });

  it('normalizes undefined data to null', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(httpContext({ id: 'req-2' }), handlerOf(undefined)),
    );

    expect(result.data).toBeNull();
  });

  it('does not double-wrap an existing envelope', async () => {
    const existing = { success: true as const, data: { a: 1 }, requestId: 'x' };

    const result = await firstValueFrom(
      interceptor.intercept(httpContext({ id: 'req-3' }), handlerOf(existing)),
    );

    expect(result).toBe(existing);
    // An already-enveloped response is returned untouched — no `meta` is added.
    expect(result).not.toHaveProperty('meta');
  });

  it('hoists a paginated collection to data and top-level meta', async () => {
    const meta = { page: 1, pageSize: 20, total: 2, totalPages: 1 };
    const collection = new CollectionResult([{ a: 1 }, { a: 2 }], meta);

    const result = await firstValueFrom(
      interceptor.intercept(httpContext({ id: 'req-4' }), handlerOf(collection)),
    );

    // Exact documented collection contract (14-api-design-standards.md §6.2):
    // items hoisted to `data`, pagination metadata hoisted to top-level `meta`.
    expect(result).toEqual({
      success: true,
      data: [{ a: 1 }, { a: 2 }],
      meta,
      requestId: 'req-4',
    });
    expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
  });

  it('passes through non-http contexts untouched', async () => {
    const context = {
      getType: () => 'rpc',
    } as unknown as ExecutionContext;

    const result = await firstValueFrom(
      interceptor.intercept(context, handlerOf('raw')),
    );

    expect(result).toBe('raw');
  });
});
