import type { ErrorCode } from '../errors/error-code.enum';

/** Pagination metadata for collection responses. */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Standard success envelope for a single resource or command result. */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
  requestId: string;
}

/** Error body carried inside {@link ApiErrorResponse}. */
export interface ApiErrorBody {
  code: ErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
}

/** Standard error envelope returned by the global exception filter. */
export interface ApiErrorResponse {
  success: false;
  error: ApiErrorBody;
  requestId: string;
  timestamp: string;
  path: string;
}
