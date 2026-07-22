import type { ResolvedPagination } from '../../src/common/pagination/pagination';
import { UniqueConstraintViolationError } from '../../src/infrastructure/database/database.errors';
import { BusStatus } from '../../src/modules/buses/bus-status';
import type {
  BusesRepository,
  PagedResult,
} from '../../src/modules/buses/buses.repository';
import type { Bus, BusCreate, BusUpdate } from '../../src/modules/buses/bus.types';

interface SeedBus {
  id: string;
  companyId: string;
  seatLayoutId: string;
  plateNumber: string;
  busModel?: string;
  status?: BusStatus;
  isActive?: boolean;
  currentOdometerKm?: number;
}

/**
 * In-memory {@link BusesRepository} for e2e tests. Preserves the SQL adapter's
 * observable semantics — company scoping, the composite unique constraint on
 * (company, plate_number), version increments on every mutation, and atomic
 * activation transitions — without a real database.
 */
export class InMemoryBusesRepository implements BusesRepository {
  private readonly buses: Bus[] = [];
  private sequence = 5000;
  private failWith: Error | null = null;

  addBus(seed: SeedBus): void {
    const now = new Date('2026-01-01T00:00:00.000Z');
    this.buses.push({
      id: seed.id,
      companyId: seed.companyId,
      seatLayoutId: seed.seatLayoutId,
      plateNumber: seed.plateNumber,
      busModel: seed.busModel,
      status: seed.status ?? BusStatus.Active,
      isActive: seed.isActive ?? true,
      currentOdometerKm: seed.currentOdometerKm ?? 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Make the next repository call reject, to exercise the dependency-error path. */
  failNextWith(error: Error): void {
    this.failWith = error;
  }

  private maybeFail(): void {
    if (this.failWith) {
      const error = this.failWith;
      this.failWith = null;
      throw error;
    }
  }

  private plateTaken(
    companyId: string,
    plateNumber: string,
    exceptId?: string,
  ): boolean {
    return this.buses.some(
      (b) =>
        b.companyId === companyId &&
        b.plateNumber === plateNumber &&
        b.id !== exceptId,
    );
  }

  listByCompany(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Bus>> {
    this.maybeFail();
    const all = this.buses.filter((b) => b.companyId === companyId);
    const page = all.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );
    return Promise.resolve({ items: page, total: all.length });
  }

  findInCompany(companyId: string, busId: string): Promise<Bus | null> {
    this.maybeFail();
    return Promise.resolve(
      this.buses.find((b) => b.id === busId && b.companyId === companyId) ??
        null,
    );
  }

  create(companyId: string, input: BusCreate): Promise<Bus> {
    this.maybeFail();
    if (this.plateTaken(companyId, input.plateNumber)) {
      throw new UniqueConstraintViolationError();
    }
    const now = new Date();
    const bus: Bus = {
      id: String(++this.sequence),
      companyId,
      seatLayoutId: input.seatLayoutId,
      plateNumber: input.plateNumber,
      busModel: input.busModel,
      status: BusStatus.Active,
      isActive: true,
      currentOdometerKm: input.currentOdometerKm ?? 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.buses.push(bus);
    return Promise.resolve(bus);
  }

  update(
    companyId: string,
    busId: string,
    input: BusUpdate,
  ): Promise<Bus | null> {
    this.maybeFail();
    const index = this.buses.findIndex(
      (b) => b.id === busId && b.companyId === companyId,
    );
    if (index === -1) {
      return Promise.resolve(null);
    }
    const current = this.buses[index];
    if (
      input.plateNumber !== undefined &&
      this.plateTaken(companyId, input.plateNumber, busId)
    ) {
      throw new UniqueConstraintViolationError();
    }
    const next: Bus = {
      ...current,
      seatLayoutId: input.seatLayoutId ?? current.seatLayoutId,
      plateNumber: input.plateNumber ?? current.plateNumber,
      busModel:
        input.busModel === undefined
          ? current.busModel
          : (input.busModel ?? undefined),
      currentOdometerKm: input.currentOdometerKm ?? current.currentOdometerKm,
      version: current.version + 1,
      updatedAt: new Date(),
    };
    this.buses[index] = next;
    return Promise.resolve(next);
  }

  transitionActive(
    companyId: string,
    busId: string,
    target: boolean,
  ): Promise<Bus | null> {
    this.maybeFail();
    const index = this.buses.findIndex(
      (b) =>
        b.id === busId &&
        b.companyId === companyId &&
        b.isActive === !target,
    );
    if (index === -1) {
      return Promise.resolve(null);
    }
    const next: Bus = {
      ...this.buses[index],
      isActive: target,
      version: this.buses[index].version + 1,
      updatedAt: new Date(),
    };
    this.buses[index] = next;
    return Promise.resolve(next);
  }
}
