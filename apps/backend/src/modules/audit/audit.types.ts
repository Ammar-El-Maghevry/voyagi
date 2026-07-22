/** JSON values supported by PostgreSQL jsonb audit metadata. */
export type AuditJsonValue =
  | null
  | boolean
  | number
  | string
  | AuditJsonObject
  | AuditJsonValue[];

/** Audit metadata is always a JSON object at its root. */
export interface AuditJsonObject {
  readonly [key: string]: AuditJsonValue;
}

/** A tenant-scoped, append-only audit record safe to return through the API. */
export interface AuditLog {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly companyId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly oldValues: AuditJsonObject | null;
  readonly newValues: AuditJsonObject | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly createdAt: Date;
}

/** Input for an append performed as part of an existing transaction. */
export interface AuditAppendInput {
  readonly actorUserId?: string | null;
  readonly companyId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly oldValues?: unknown;
  readonly newValues?: unknown;
  readonly requestId?: unknown;
  readonly correlationId?: unknown;
}
