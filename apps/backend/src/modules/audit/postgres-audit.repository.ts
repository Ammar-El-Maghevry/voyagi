import { Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { isValidUuid } from '../../common/request-context/correlation-id.util';
import { sanitizeAuditMetadata } from './audit.metadata';
import { AUDIT_LOG_COLUMNS, type AuditLogRow, toAuditLog } from './audit.mapper';
import type { AuditAppendInput, AuditLog } from './audit.types';
import type { AuditPage, AuditRepository } from './audit.repository';

@Injectable()
export class PostgresAuditRepository implements AuditRepository {
  async listByCompany(
    executor: DatabaseExecutor,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<AuditPage> {
    const rows = await executor.query<AuditLogRow>(
      `SELECT ${AUDIT_LOG_COLUMNS}
         FROM public.audit_logs
        WHERE company_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [companyId, pagination.limit, pagination.offset],
      { name: 'audit.list_by_company' },
    );
    const count = await executor.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM public.audit_logs WHERE company_id = $1',
      [companyId],
      { name: 'audit.count_by_company' },
    );
    return {
      items: rows.rows.map(toAuditLog),
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  async append(executor: DatabaseExecutor, input: AuditAppendInput): Promise<AuditLog> {
    const result = await executor.query<AuditLogRow>(
      `INSERT INTO public.audit_logs (
         actor_user_id, company_id, action, entity_type, entity_id,
         old_values, new_values, request_id, correlation_id
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::uuid, $9::uuid)
       RETURNING ${AUDIT_LOG_COLUMNS}`,
      [
        input.actorUserId ?? null,
        input.companyId,
        input.action,
        input.entityType,
        input.entityId,
        jsonOrNull(input.oldValues),
        jsonOrNull(input.newValues),
        isValidUuid(input.requestId) ? input.requestId : null,
        isValidUuid(input.correlationId) ? input.correlationId : null,
      ],
      { name: 'audit.append' },
    );
    return toAuditLog(result.rows[0]!);
  }
}

function jsonOrNull(value: unknown): string | null {
  const metadata = sanitizeAuditMetadata(value);
  return metadata === null ? null : JSON.stringify(metadata);
}
