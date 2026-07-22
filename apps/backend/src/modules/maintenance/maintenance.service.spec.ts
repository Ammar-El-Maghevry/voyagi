import type { DatabaseService, TransactionManager } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { BusStatus } from '../buses/bus-status';
import { MaintenanceConflictError } from './maintenance.errors';
import type { MaintenanceRepository, PagedResult } from './maintenance.repository';
import { MaintenanceStatus } from './maintenance-status';
import { MaintenanceAction } from './maintenance-transitions';
import { MaintenanceType } from './maintenance-type';
import type { LockedBus, MaintenanceCreate, MaintenanceRecord } from './maintenance.types';
import { MaintenanceService } from './maintenance.service';

function makeRecord(overrides: Partial<MaintenanceRecord> = {}): MaintenanceRecord {
  return {
    id: '8',
    companyId: '10',
    busId: '5',
    maintenanceType: MaintenanceType.GeneralService,
    status: MaintenanceStatus.Scheduled,
    startedAt: new Date('2026-03-01T08:00:00.000Z'),
    scheduledEndsAt: new Date('2026-03-01T12:00:00.000Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakeMaintenanceRepository implements MaintenanceRepository {
  record: MaintenanceRecord | null = makeRecord();
  bus: LockedBus | null = { isActive: true, status: BusStatus.Active };
  liveTripOverlap = false;
  restored = false;

  listByCompany(): Promise<PagedResult<MaintenanceRecord>> {
    return Promise.resolve({ items: this.record ? [this.record] : [], total: this.record ? 1 : 0 });
  }
  findInCompany(): Promise<MaintenanceRecord | null> {
    return Promise.resolve(this.record);
  }
  lockBus(): Promise<LockedBus | null> {
    return Promise.resolve(this.bus);
  }
  hasActiveRecord(_e: DatabaseExecutor, _c: string, _b: string, exceptRecordId?: string): Promise<boolean> {
    return Promise.resolve(
      Boolean(
        this.record &&
          this.record.id !== exceptRecordId &&
          [MaintenanceStatus.Scheduled, MaintenanceStatus.InProgress].includes(this.record.status),
      ),
    );
  }
  hasLiveTripOverlap(): Promise<boolean> {
    return Promise.resolve(this.liveTripOverlap);
  }
  insert(_e: DatabaseExecutor, companyId: string, input: MaintenanceCreate): Promise<MaintenanceRecord> {
    this.record = makeRecord({ ...input, companyId });
    return Promise.resolve(this.record);
  }
  transition(
    _e: DatabaseExecutor,
    _c: string,
    _id: string,
    from: readonly MaintenanceStatus[],
    to: MaintenanceStatus,
    stampsCompletedAt: boolean,
  ): Promise<MaintenanceRecord | null> {
    if (!this.record || !from.includes(this.record.status)) {
      return Promise.resolve(null);
    }
    this.record = {
      ...this.record,
      status: to,
      completedAt: stampsCompletedAt ? new Date() : this.record.completedAt,
    };
    return Promise.resolve(this.record);
  }
  setBusInMaintenance(): Promise<boolean> {
    if (!this.bus || this.bus.status !== BusStatus.Active) {
      return Promise.resolve(false);
    }
    this.bus = { ...this.bus, status: BusStatus.InMaintenance };
    return Promise.resolve(true);
  }
  restoreBusActiveIfInMaintenance(): Promise<void> {
    this.restored = true;
    if (this.bus?.status === BusStatus.InMaintenance) {
      this.bus = { ...this.bus, status: BusStatus.Active };
    }
    return Promise.resolve();
  }
  hasActiveMaintenanceOverlap(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

const transactions = {
  run: <T>(work: (tx: DatabaseExecutor) => Promise<T>): Promise<T> => work({} as DatabaseExecutor),
} as unknown as TransactionManager;

const audit = { append: jest.fn().mockResolvedValue({}) };

describe('MaintenanceService', () => {
  let repository: FakeMaintenanceRepository;
  let service: MaintenanceService;

  beforeEach(() => {
    repository = new FakeMaintenanceRepository();
    service = new MaintenanceService(repository, {} as DatabaseService, transactions, audit);
  });

  it('starts maintenance and makes the bus unavailable', async () => {
    const record = await service.applyAction('10', '8', MaintenanceAction.Start, 'actor');

    expect(record.status).toBe(MaintenanceStatus.InProgress);
    expect(repository.bus?.status).toBe(BusStatus.InMaintenance);
  });

  it('completes maintenance and restores only an in-maintenance bus', async () => {
    await service.applyAction('10', '8', MaintenanceAction.Start, 'actor');
    const record = await service.applyAction('10', '8', MaintenanceAction.Complete, 'actor');

    expect(record.status).toBe(MaintenanceStatus.Completed);
    expect(record.completedAt).toBeInstanceOf(Date);
    expect(repository.restored).toBe(true);
    expect(repository.bus?.status).toBe(BusStatus.Active);
  });

  it('rejects maintenance that would start during a live trip', async () => {
    repository.liveTripOverlap = true;

    await expect(
      service.applyAction('10', '8', MaintenanceAction.Start, 'actor'),
    ).rejects.toBeInstanceOf(MaintenanceConflictError);
  });
});
