import { sanitizeAuditMetadata } from './audit.metadata';
import type { AuditLog } from './audit.types';

/** Raw selected audit row. Private request/device fields are deliberately absent. */
export interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  company_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values: unknown;
  new_values: unknown;
  request_id: string | null;
  correlation_id: string | null;
  created_at: Date;
}

/** Explicit allowlisted columns for audit listing and append return values. */
export const AUDIT_LOG_COLUMNS =
  'id, actor_user_id, company_id, action, entity_type, entity_id, old_values, new_values, request_id, correlation_id, created_at';

/** Map a database row and defensively filter metadata before it reaches callers. */
export function toAuditLog(row: AuditLogRow): AuditLog {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    companyId: row.company_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    oldValues: sanitizeAuditMetadata(row.old_values),
    newValues: sanitizeAuditMetadata(row.new_values),
    requestId: row.request_id,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
  };
}
