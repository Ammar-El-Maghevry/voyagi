import type { ResolvedPagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import type { MaintenanceStatus } from './maintenance-status';
import type { MaintenanceCreate, MaintenanceRecord, LockedBus } from './maintenance.types';

export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
}

export const MAINTENANCE_REPOSITORY = Symbol('MAINTENANCE_REPOSITORY');

export interface MaintenanceRepository {
  listByCompany(
    executor: DatabaseExecutor,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<MaintenanceRecord>>;
  findInCompany(
    executor: DatabaseExecutor,
    companyId: string,
    recordId: string,
  ): Promise<MaintenanceRecord | null>;
  lockBus(
    executor: DatabaseExecutor,
    companyId: string,
    busId: string,
  ): Promise<LockedBus | null>;
  hasActiveRecord(
    executor: DatabaseExecutor,
    companyId: string,
    busId: string,
    exceptRecordId?: string,
  ): Promise<boolean>;
  hasLiveTripOverlap(
    executor: DatabaseExecutor,
    companyId: string,
    busId: string,
    startsAt: Date,
    endsAt: Date | null,
  ): Promise<boolean>;
  insert(
    executor: DatabaseExecutor,
    companyId: string,
    input: MaintenanceCreate,
    actorUserId: string,
  ): Promise<MaintenanceRecord>;
  transition(
    executor: DatabaseExecutor,
    companyId: string,
    recordId: string,
    from: readonly MaintenanceStatus[],
    to: MaintenanceStatus,
    stampsCompletedAt: boolean,
  ): Promise<MaintenanceRecord | null>;
  setBusInMaintenance(
    executor: DatabaseExecutor,
    companyId: string,
    busId: string,
  ): Promise<boolean>;
  restoreBusActiveIfInMaintenance(
    executor: DatabaseExecutor,
    companyId: string,
    busId: string,
  ): Promise<void>;
  hasActiveMaintenanceOverlap(
    executor: DatabaseExecutor,
    companyId: string,
    busId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<boolean>;
}
