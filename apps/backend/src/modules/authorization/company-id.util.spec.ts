import type { Request } from 'express';
import {
  COMPANY_ID_HEADER,
  extractCompanyId,
} from './company-id.util';

function requestWith(
  params: Record<string, string> = {},
  headers: Record<string, string | string[]> = {},
): Request {
  return { params, headers } as unknown as Request;
}

describe('extractCompanyId', () => {
  it('prefers the companyId route parameter', () => {
    const request = requestWith(
      { companyId: 'from-param' },
      { [COMPANY_ID_HEADER]: 'from-header' },
    );
    expect(extractCompanyId(request)).toBe('from-param');
  });

  it('falls back to the X-Company-Id header, trimmed', () => {
    const request = requestWith({}, { [COMPANY_ID_HEADER]: '  from-header  ' });
    expect(extractCompanyId(request)).toBe('from-header');
  });

  it('returns undefined when neither source is present', () => {
    expect(extractCompanyId(requestWith())).toBeUndefined();
  });

  it('ignores an empty route parameter and blank header', () => {
    expect(
      extractCompanyId(requestWith({ companyId: '' }, { [COMPANY_ID_HEADER]: '   ' })),
    ).toBeUndefined();
  });

  it('ignores an ambiguous multi-valued header', () => {
    const request = requestWith({}, { [COMPANY_ID_HEADER]: ['a', 'b'] });
    expect(extractCompanyId(request)).toBeUndefined();
  });
});
