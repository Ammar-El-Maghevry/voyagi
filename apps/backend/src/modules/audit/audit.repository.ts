import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import type { AuditAppendInput, AuditLog } from './audit.types';

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

export interface AuditPage {
  readonly items: readonly AuditLog[];
  readonly total: number;
}

/** Persistence boundary for tenant-scoped audit reads and transaction appends. */
export interface AuditRepository {
  listByCompany(
    executor: DatabaseExecutor,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<AuditPage>;
  append(executor: DatabaseExecutor, input: AuditAppendInput): Promise<AuditLog>;
}
