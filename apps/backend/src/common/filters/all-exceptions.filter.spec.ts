import {
  ArgumentsHost,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ErrorCode } from '../errors/error-code.enum';
import type { ApiErrorResponse } from '../interfaces/api-response.interface';
import { ValidationException } from '../validation/validation.exception';
import { AllExceptionsFilter } from './all-exceptions.filter';

function createHost(): {
  host: ArgumentsHost;
  getPayload: () => ApiErrorResponse;
  getStatus: () => number;
} {
  let status = 0;
  let payload: ApiErrorResponse | undefined;

  const response = {
    status: (code: number) => {
      status = code;
      return response;
    },
    json: (body: ApiErrorResponse) => {
      payload = body;
      return response;
    },
  };

  const request = {
    id: 'req-err',
    method: 'GET',
    originalUrl: '/api/v1/does-not-exist',
  };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return {
    host,
    getPayload: () => {
      if (!payload) {
        throw new Error('response.json was not called');
      }
      return payload;
    },
    getStatus: () => status,
  };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('renders validation errors with structured field details', () => {
    const { host, getPayload, getStatus } = createHost();

    filter.catch(new ValidationException({ email: ['must be an email'] }), host);

    expect(getStatus()).toBe(400);
    const payload = getPayload();
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(payload.error.details).toEqual({
      fields: { email: ['must be an email'] },
    });
    expect(payload.requestId).toBe('req-err');
    expect(payload.path).toBe('/api/v1/does-not-exist');
    expect(typeof payload.timestamp).toBe('string');
  });

  it('maps a NotFoundException to RESOURCE_NOT_FOUND (404)', () => {
    const { host, getPayload, getStatus } = createHost();

    filter.catch(new NotFoundException('Cannot GET /x'), host);

    expect(getStatus()).toBe(404);
    expect(getPayload().error.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
  });

  it('maps a ForbiddenException to FORBIDDEN (403)', () => {
    const { host, getPayload, getStatus } = createHost();

    filter.catch(new ForbiddenException(), host);

    expect(getStatus()).toBe(403);
    expect(getPayload().error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('sanitizes unknown errors and never leaks their contents', () => {
    const { host, getPayload, getStatus } = createHost();

    filter.catch(new Error('DB password is hunter2 at table users'), host);

    expect(getStatus()).toBe(500);
    const payload = getPayload();
    expect(payload.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(payload.error.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(payload)).not.toContain('hunter2');
  });
});
