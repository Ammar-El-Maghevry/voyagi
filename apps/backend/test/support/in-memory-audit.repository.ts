import type { ResolvedPagination } from '../../src/common/pagination/pagination';
import type { DatabaseExecutor } from '../../src/infrastructure/database/database.types';
import type { Transaction } from '../../src/infrastructure/database/transaction.manager';
import type {
  AuditPage,
  AuditRepository,
} from '../../src/modules/audit/audit.repository';
import type { AuditAppendInput, AuditLog } from '../../src/modules/audit/audit.types';

/** In-memory append-only audit store for HTTP tests. */
export class InMemoryAuditRepository implements AuditRepository {
  private readonly logs: AuditLog[] = [];
  private sequence = 500;

  addLog(log: AuditLog): void {
    this.logs.push(log);
  }

  listByCompany(
    _executor: DatabaseExecutor,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<AuditPage> {
    const all = this.logs.filter((log) => log.companyId === companyId);
    return Promise.resolve({
      items: all.slice(pagination.offset, pagination.offset + pagination.limit),
      total: all.length,
    });
  }

  append(_executor: Transaction, input: AuditAppendInput): Promise<AuditLog> {
    const log: AuditLog = {
      id: String(++this.sequence),
      actorUserId: input.actorUserId ?? null,
      companyId: input.companyId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValues: (input.oldValues as AuditLog['oldValues']) ?? null,
      newValues: (input.newValues as AuditLog['newValues']) ?? null,
      requestId: typeof input.requestId === 'string' ? input.requestId : null,
      correlationId:
        typeof input.correlationId === 'string' ? input.correlationId : null,
      createdAt: new Date(),
    };
    this.logs.push(log);
    return Promise.resolve(log);
  }
}
