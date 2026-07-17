import type { PaginationMeta } from '../interfaces/api-response.interface';

/**
 * Bounded pagination primitives shared by repositories (to derive
 * `LIMIT`/`OFFSET`) and controllers (to build response `meta`), matching the
 * API standard: default page 1, default page size 20, maximum page size 100
 * (see `architecture/14-api-design-standards.md`).
 *
 * These are pure, domain-agnostic helpers — no SQL and no business logic.
 */
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Raw, possibly-invalid pagination input from a request. */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

/** Normalized pagination with derived SQL bounds. */
export interface ResolvedPagination {
  page: number;
  pageSize: number;
  limit: number;
  offset: number;
}

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  const truncated = Math.trunc(value);
  return truncated >= 1 ? truncated : fallback;
}

/**
 * Normalize request pagination into safe, bounded values and derive
 * `limit`/`offset`. Invalid or out-of-range inputs fall back to the documented
 * defaults and are clamped to the maximum page size.
 */
export function resolvePagination(
  params: PaginationParams = {},
): ResolvedPagination {
  const page = toPositiveInt(params.page, DEFAULT_PAGE);
  const requestedSize = toPositiveInt(params.pageSize, DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(MAX_PAGE_SIZE, requestedSize);

  return {
    page,
    pageSize,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
}

/** Build the standard collection {@link PaginationMeta} from a total count. */
export function buildPaginationMeta(
  page: number,
  pageSize: number,
  total: number,
): PaginationMeta {
  const safeTotal = Math.max(0, Math.trunc(total));
  const totalPages = pageSize > 0 ? Math.ceil(safeTotal / pageSize) : 0;
  return { page, pageSize, total: safeTotal, totalPages };
}
