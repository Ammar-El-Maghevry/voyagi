import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { DatabaseService, TransactionManager } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { AUDIT_WRITER, type AuditWriterPort } from '../audit/audit.service';
import { parsePositiveBigInt } from '../identity/identifier.util';
import { BusStatus } from '../buses/bus-status';
import {
  MaintenanceBusInvalidError,
  MaintenanceCompanyInvalidError,
  MaintenanceConflictError,
  MaintenanceNotFoundError,
} from './maintenance.errors';
import {
  MAINTENANCE_REPOSITORY,
  type MaintenanceRepository,
  type PagedResult,
} from './maintenance.repository';
import { MAINTENANCE_TRANSITIONS, type MaintenanceAction } from './maintenance-transitions';
import type { MaintenanceSchedulingPort } from './maintenance-scheduling.port';
import type { MaintenanceCreate, MaintenanceRecord } from './maintenance.types';

const EMPTY_PAGE: PagedResult<MaintenanceRecord> = { items: [], total: 0 };

@Injectable()
export class MaintenanceService implements MaintenanceSchedulingPort {
  constructor(
    @Inject(MAINTENANCE_REPOSITORY) private readonly records: MaintenanceRepository,
    private readonly db: DatabaseService,
    private readonly transactions: TransactionManager,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriterPort,
  ) {}

  async listRecords(companyId: string | undefined, pagination: ResolvedPagination): Promise<PagedResult<MaintenanceRecord>> {
    const normalizedCompanyId = parsePositiveBigInt(companyId ?? '');
    if (normalizedCompanyId === null) {
      return EMPTY_PAGE;
    }
    return this.records.listByCompany(this.db, normalizedCompanyId, pagination);
  }

  async createRecord(
    companyId: string | undefined,
    input: MaintenanceCreate,
    actorUserId: string,
    context: { requestId?: string; correlationId?: string } = {},
  ): Promise<MaintenanceRecord> {
    const c = this.companyId(companyId);
    const busId = parsePositiveBigInt(input.busId);
    if (busId === null) {
      throw new MaintenanceBusInvalidError('The bus id must be valid.');
    }
    this.assertPlannedWindow(input.startedAt, input.scheduledEndsAt);

    return this.transactions.run(async (tx) => {
      const bus = await this.records.lockBus(tx, c, busId);
      if (!bus || !bus.isActive) {
        throw new MaintenanceBusInvalidError();
      }
      if (await this.records.hasActiveRecord(tx, c, busId)) {
        throw new MaintenanceConflictError('The bus already has active maintenance.');
      }
      if (await this.records.hasLiveTripOverlap(tx, c, busId, input.startedAt, input.scheduledEndsAt)) {
        throw new MaintenanceConflictError('The planned maintenance overlaps a live trip.');
      }
      const record = await this.records.insert(tx, c, { ...input, busId }, actorUserId);
      await this.audit.append(tx, {
        actorUserId,
        companyId: c,
        action: 'MAINTENANCE_SCHEDULED',
        entityType: 'vehicle_maintenance_record',
        entityId: record.id,
        newValues: { status: record.status, maintenanceId: record.id },
        ...context,
      });
      return record;
    });
  }

  async applyAction(
    companyId: string | undefined,
    recordId: string,
    action: MaintenanceAction,
    actorUserId: string,
    context: { requestId?: string; correlationId?: string } = {},
  ): Promise<MaintenanceRecord> {
    const c = this.companyId(companyId);
    const id = parsePositiveBigInt(recordId);
    if (id === null) {
      throw new MaintenanceNotFoundError();
    }
    const transition = MAINTENANCE_TRANSITIONS[action];

    return this.transactions.run(async (tx) => {
      const existing = await this.records.findInCompany(tx, c, id);
      if (!existing) {
        throw new MaintenanceNotFoundError();
      }
      const bus = await this.records.lockBus(tx, c, existing.busId);
      if (!bus) {
        throw new MaintenanceBusInvalidError();
      }
      if (action === 'start') {
        if (await this.records.hasLiveTripOverlap(tx, c, existing.busId, new Date(), null)) {
          throw new MaintenanceConflictError('The maintenance cannot start while the bus has a live trip.');
        }
        if (bus.status !== BusStatus.Active) {
          throw new MaintenanceConflictError('The bus is not in an active operational state.');
        }
      }
      const changed = await this.records.transition(
        tx,
        c,
        id,
        [...transition.from],
        transition.to,
        transition.stampsCompletedAt,
      );
      if (!changed) {
        if (!(await this.records.findInCompany(tx, c, id))) {
          throw new MaintenanceNotFoundError();
        }
        throw new MaintenanceConflictError('The maintenance record is not in a state that allows this action.');
      }
      if (action === 'start' && !(await this.records.setBusInMaintenance(tx, c, existing.busId))) {
        throw new MaintenanceConflictError('The bus is not in an active operational state.');
      }
      if (action !== 'start' && !(await this.records.hasActiveRecord(tx, c, existing.busId))) {
        // This predicate keeps OUT_OF_SERVICE and ARCHIVED untouched.
        await this.records.restoreBusActiveIfInMaintenance(tx, c, existing.busId);
      }
      await this.audit.append(tx, {
        actorUserId,
        companyId: c,
        action: `MAINTENANCE_${action.toUpperCase()}`,
        entityType: 'vehicle_maintenance_record',
        entityId: changed.id,
        oldValues: { status: existing.status, maintenanceId: existing.id },
        newValues: { status: changed.status, maintenanceId: changed.id },
        ...context,
      });
      return changed;
    });
  }

  async hasActiveMaintenanceOverlap(
    executor: DatabaseExecutor,
    companyId: string,
    busId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<boolean> {
    return this.records.hasActiveMaintenanceOverlap(executor, companyId, busId, startsAt, endsAt);
  }

  private companyId(value: string | undefined): string {
    const companyId = parsePositiveBigInt(value ?? '');
    if (companyId === null) {
      throw new MaintenanceCompanyInvalidError();
    }
    return companyId;
  }

  private assertPlannedWindow(startsAt: Date, endsAt: Date): void {
    if (endsAt <= startsAt) {
      throw new MaintenanceBusInvalidError('scheduledEndsAt must be after startedAt.');
    }
  }
}
