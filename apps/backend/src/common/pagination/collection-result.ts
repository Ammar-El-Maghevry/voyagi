import type { PaginationMeta } from '../interfaces/api-response.interface';

/**
 * A paginated collection returned by a controller.
 *
 * Controllers return this instead of a bare array so the
 * {@link ResponseEnvelopeInterceptor} can hoist the items to `data` and the
 * pagination metadata to the envelope's top-level `meta` field, matching the
 * collection response contract in `architecture/14-api-design-standards.md`.
 * Single-resource endpoints keep returning plain data.
 */
export class CollectionResult<T> {
  constructor(
    readonly items: readonly T[],
    readonly meta: PaginationMeta,
  ) {}
}
