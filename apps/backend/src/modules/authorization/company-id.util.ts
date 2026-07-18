import type { Request } from 'express';

/** Header carrying the active company (tenant) id when it is not in the path. */
export const COMPANY_ID_HEADER = 'x-company-id';

/**
 * Extract the target company (tenant) id from a request.
 *
 * Prefers an explicit `companyId` route parameter, then the `X-Company-Id`
 * header. The value only names which company the caller is *acting on* — it is
 * never treated as proof of membership; the resolver must still verify an
 * active membership before granting permissions. Ambiguous (array) header
 * values are ignored.
 */
export function extractCompanyId(request: Request): string | undefined {
  const param = request.params?.companyId;
  if (typeof param === 'string' && param.length > 0) {
    return param;
  }

  const header = request.headers?.[COMPANY_ID_HEADER];
  if (typeof header === 'string' && header.trim().length > 0) {
    return header.trim();
  }

  return undefined;
}
