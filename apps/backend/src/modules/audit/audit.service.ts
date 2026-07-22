import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { DatabaseService } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import type { Transaction } from '../../infrastructure/database/transaction.manager';
import {
  AUDIT_REPOSITORY,
  type AuditPage,
  type AuditRepository,
} from './audit.repository';
import type { AuditAppendInput, AuditLog } from './audit.types';

/** Injectable append port for future domain transactions. */
export interface AuditWriterPort {
  append(transaction: Transaction, input: AuditAppendInput): Promise<AuditLog>;
}

/** DI token for future modules that need the transaction append port. */
export const AUDIT_WRITER = Symbol('AUDIT_WRITER');

/** Reads audit records and appends sanitized records to a caller-owned transaction. */
@Injectable()
export class AuditWriter implements AuditWriterPort {
  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly repository: AuditRepository,
  ) {}

  append(transaction: Transaction, input: AuditAppendInput): Promise<AuditLog> {
    return this.repository.append(transaction, input);
  }
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly repository: AuditRepository,
    @Inject(DatabaseService) private readonly database: DatabaseExecutor,
  ) {}

  listCompanyAuditLogs(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<AuditPage> {
    return this.repository.listByCompany(this.database, companyId, pagination);
  }
}
