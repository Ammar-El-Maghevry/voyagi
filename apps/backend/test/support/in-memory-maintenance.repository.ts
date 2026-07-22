import type { ResolvedPagination } from '../../src/common/pagination/pagination';
import type { DatabaseExecutor } from '../../src/infrastructure/database/database.types';
import { BusStatus } from '../../src/modules/buses/bus-status';
import { MaintenanceStatus } from '../../src/modules/maintenance/maintenance-status';
import type {
  MaintenanceRepository,
  PagedResult,
} from '../../src/modules/maintenance/maintenance.repository';
import type {
  LockedBus,
  MaintenanceCreate,
  MaintenanceRecord,
} from '../../src/modules/maintenance/maintenance.types';

interface SeedBus {
  id: string;
  companyId: string;
  isActive?: boolean;
  status?: BusStatus;
}

/** In-memory maintenance store for HTTP tests that need lifecycle semantics. */
export class InMemoryMaintenanceRepository implements MaintenanceRepository {
  private readonly records: MaintenanceRecord[] = [];
  private readonly buses = new Map<string, LockedBus>();
  private sequence = 100;

  addBus(seed: SeedBus): void {
    this.buses.set(this.busKey(seed.companyId, seed.id), {
      isActive: seed.isActive ?? true,
      status: seed.status ?? BusStatus.Active,
    });
  }

  addRecord(record: MaintenanceRecord): void {
    this.records.push(record);
  }

  listByCompany(
    _executor: DatabaseExecutor,
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<MaintenanceRecord>> {
    const all = this.records.filter((record) => record.companyId === companyId);
    return Promise.resolve({
      items: all.slice(pagination.offset, pagination.offset + pagination.limit),
      total: all.length,
    });
  }

  findInCompany(
    _executor: DatabaseExecutor,
    companyId: string,
    recordId: string,
  ): Promise<MaintenanceRecord | null> {
    return Promise.resolve(
      this.records.find(
        (record) => record.companyId === companyId && record.id === recordId,
      ) ?? null,
    );
  }

  lockBus(
    _executor: DatabaseExecutor,
    companyId: string,
    busId: string,
  ): Promise<LockedBus | null> {
    return Promise.resolve(this.buses.get(this.busKey(companyId, busId)) ?? null);
  }

  hasActiveRecord(
    _executor: DatabaseExecutor,
    companyId: string,
    busId: string,
    exceptRecordId?: string,
  ): Promise<boolean> {
    return Promise.resolve(
      this.records.some(
        (record) =>
          record.companyId === companyId &&
          record.busId === busId &&
          record.id !== exceptRecordId &&
          (record.status === MaintenanceStatus.Scheduled ||
            record.status === MaintenanceStatus.InProgress),
      ),
    );
  }

  hasLiveTripOverlap(): Promise<boolean> {
    return Promise.resolve(false);
  }

  insert(
    _executor: DatabaseExecutor,
    companyId: string,
    input: MaintenanceCreate,
    actorUserId: string,
  ): Promise<MaintenanceRecord> {
    const now = new Date();
    const record: MaintenanceRecord = {
      id: String(++this.sequence),
      companyId,
      busId: input.busId,
      maintenanceType: input.maintenanceType,
      description: input.description,
      costMru: input.costMru,
      odometerKm: input.odometerKm,
      startedAt: input.startedAt,
      scheduledEndsAt: input.scheduledEndsAt,
      nextMaintenanceAt: input.nextMaintenanceAt,
      status: MaintenanceStatus.Scheduled,
      createdByUserId: actorUserId,
      createdAt: now,
      updatedAt: now,
    };
    this.records.push(record);
    return Promise.resolve(record);
  }

  transition(
    _executor: DatabaseExecutor,
    companyId: string,
    recordId: string,
    from: readonly MaintenanceStatus[],
    to: MaintenanceStatus,
    stampsCompletedAt: boolean,
  ): Promise<MaintenanceRecord | null> {
    const index = this.records.findIndex(
      (record) =>
        record.companyId === companyId &&
        record.id === recordId &&
        from.includes(record.status),
    );
    if (index === -1) return Promise.resolve(null);

    const current = this.records[index];
    const next: MaintenanceRecord = {
      ...current,
      status: to,
      completedAt: stampsCompletedAt ? new Date() : current.completedAt,
      updatedAt: new Date(),
    };
    this.records[index] = next;
    return Promise.resolve(next);
  }

  setBusInMaintenance(
    _executor: DatabaseExecutor,
    companyId: string,
    busId: string,
  ): Promise<boolean> {
    const key = this.busKey(companyId, busId);
    const bus = this.buses.get(key);
    if (!bus || bus.status !== BusStatus.Active) return Promise.resolve(false);
    this.buses.set(key, { ...bus, status: BusStatus.InMaintenance });
    return Promise.resolve(true);
  }

  restoreBusActiveIfInMaintenance(
    _executor: DatabaseExecutor,
    companyId: string,
    busId: string,
  ): Promise<void> {
    const key = this.busKey(companyId, busId);
    const bus = this.buses.get(key);
    if (bus?.status === BusStatus.InMaintenance) {
      this.buses.set(key, { ...bus, status: BusStatus.Active });
    }
    return Promise.resolve();
  }

  hasActiveMaintenanceOverlap(): Promise<boolean> {
    return Promise.resolve(false);
  }

  private busKey(companyId: string, busId: string): string {
    return `${companyId}:${busId}`;
  }
}
