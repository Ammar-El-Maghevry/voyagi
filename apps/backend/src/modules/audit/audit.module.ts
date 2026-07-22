import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AUDIT_REPOSITORY } from './audit.repository';
import { AUDIT_WRITER, AuditService, AuditWriter } from './audit.service';
import { PostgresAuditRepository } from './postgres-audit.repository';

/** Standalone audit read and transaction-append module. */
@Module({
  controllers: [AuditController],
  providers: [
    { provide: AUDIT_REPOSITORY, useClass: PostgresAuditRepository },
    AuditService,
    AuditWriter,
    { provide: AUDIT_WRITER, useExisting: AuditWriter },
  ],
  exports: [AuditWriter, AUDIT_WRITER],
})
export class AuditModule {}
