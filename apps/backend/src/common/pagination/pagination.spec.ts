import {
  buildPaginationMeta,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  resolvePagination,
} from './pagination';

describe('resolvePagination', () => {
  it('applies documented defaults when nothing is provided', () => {
    expect(resolvePagination()).toEqual({
      page: DEFAULT_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
      limit: DEFAULT_PAGE_SIZE,
      offset: 0,
    });
  });

  it('derives limit and offset from page and pageSize', () => {
    expect(resolvePagination({ page: 3, pageSize: 25 })).toEqual({
      page: 3,
      pageSize: 25,
      limit: 25,
      offset: 50,
    });
  });

  it('clamps page size to the maximum', () => {
    const resolved = resolvePagination({ page: 1, pageSize: 1000 });
    expect(resolved.pageSize).toBe(MAX_PAGE_SIZE);
    expect(resolved.limit).toBe(MAX_PAGE_SIZE);
  });

  it('falls back to defaults for invalid values', () => {
    expect(resolvePagination({ page: 0, pageSize: -5 })).toMatchObject({
      page: DEFAULT_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    expect(resolvePagination({ page: NaN, pageSize: 1.9 })).toMatchObject({
      page: DEFAULT_PAGE,
      pageSize: 1,
    });
  });
});

describe('buildPaginationMeta', () => {
  it('computes totalPages by rounding up', () => {
    expect(buildPaginationMeta(1, 20, 45)).toEqual({
      page: 1,
      pageSize: 20,
      total: 45,
      totalPages: 3,
    });
  });

  it('handles an empty result set', () => {
    expect(buildPaginationMeta(1, 20, 0)).toEqual({
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it('never reports a negative total', () => {
    expect(buildPaginationMeta(1, 20, -10).total).toBe(0);
  });
});
