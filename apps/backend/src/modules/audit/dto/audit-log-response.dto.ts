import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AuditLog, AuditJsonObject } from '../audit.types';

/** Allowlisted audit record representation; network/device details are omitted. */
export class AuditLogResponseDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ nullable: true }) actorUserId!: string | null;
  @ApiProperty() companyId!: string;
  @ApiProperty() action!: string;
  @ApiProperty() entityType!: string;
  @ApiProperty() entityId!: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  oldValues!: AuditJsonObject | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  newValues!: AuditJsonObject | null;
  @ApiPropertyOptional({ nullable: true }) requestId!: string | null;
  @ApiPropertyOptional({ nullable: true }) correlationId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;

  static from(log: AuditLog): AuditLogResponseDto {
    return {
      id: log.id,
      actorUserId: log.actorUserId,
      companyId: log.companyId,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      oldValues: log.oldValues,
      newValues: log.newValues,
      requestId: log.requestId,
      correlationId: log.correlationId,
      createdAt: log.createdAt.toISOString(),
    };
  }
}
