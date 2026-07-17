import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
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
