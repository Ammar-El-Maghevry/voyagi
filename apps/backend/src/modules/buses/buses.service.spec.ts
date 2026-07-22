import { ValidationException } from '../../common/validation/validation.exception';
import { resolvePagination } from '../../common/pagination/pagination';
import { BusStatus } from './bus-status';
import { BusNotFoundError, BusStateConflictError } from './bus.errors';
import { BusesService } from './buses.service';
import type { BusesRepository, PagedResult } from './buses.repository';
import type { Bus, BusCreate, BusUpdate } from './bus.types';

function makeBus(overrides: Partial<Bus> = {}): Bus {
  return {
    id: '5',
    companyId: '10',
    seatLayoutId: '3',
    plateNumber: 'ABC-123',
    busModel: 'Coach',
    status: BusStatus.Active,
    isActive: true,
    currentOdometerKm: 0,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** Minimal in-memory port double for isolated service tests. */
class FakeBusesRepository implements BusesRepository {
  buses: Bus[] = [];
  transitionResult: Bus | null = null;

  listByCompany(companyId: string): Promise<PagedResult<Bus>> {
    const items = this.buses.filter((b) => b.companyId === companyId);
    return Promise.resolve({ items, total: items.length });
  }
  findInCompany(companyId: string, busId: string): Promise<Bus | null> {
    return Promise.resolve(
      this.buses.find((b) => b.id === busId && b.companyId === companyId) ?? null,
    );
  }
  create(companyId: string, input: BusCreate): Promise<Bus> {
    return Promise.resolve(makeBus({ companyId, ...input }));
  }
  update(
    companyId: string,
    busId: string,
    input: BusUpdate,
  ): Promise<Bus | null> {
    const bus = this.buses.find(
      (b) => b.id === busId && b.companyId === companyId,
    );
    if (!bus) {
      return Promise.resolve(null);
    }
    return Promise.resolve(
      makeBus({
        ...bus,
        seatLayoutId: input.seatLayoutId ?? bus.seatLayoutId,
        plateNumber: input.plateNumber ?? bus.plateNumber,
        busModel:
          input.busModel === undefined
            ? bus.busModel
            : (input.busModel ?? undefined),
        currentOdometerKm: input.currentOdometerKm ?? bus.currentOdometerKm,
      }),
    );
  }
  transitionActive(): Promise<Bus | null> {
    return Promise.resolve(this.transitionResult);
  }
}

describe('BusesService', () => {
  let repo: FakeBusesRepository;
  let service: BusesService;

  beforeEach(() => {
    repo = new FakeBusesRepository();
    service = new BusesService(repo);
  });

  it('returns an empty page for a malformed company id (no query)', async () => {
    const page = await service.listBuses('not-a-number', resolvePagination());
    expect(page).toEqual({ items: [], total: 0 });
  });

  it('404s a bus addressed under the wrong company (tenant isolation)', async () => {
    repo.buses.push(makeBus({ id: '5', companyId: '10' }));
    // Same id, different company target → not found, never leaked.
    await expect(service.getBus('20', '5')).rejects.toBeInstanceOf(
      BusNotFoundError,
    );
  });

  it('rejects an empty update with a validation error', async () => {
    await expect(service.updateBus('10', '5', {})).rejects.toBeInstanceOf(
      ValidationException,
    );
  });

  it('reports a redundant activation as a conflict, a missing bus as not-found', async () => {
    // No row transitioned but the bus exists → already in the target state.
    repo.buses.push(makeBus({ id: '5', companyId: '10', isActive: true }));
    repo.transitionResult = null;
    await expect(service.setBusActive('10', '5', true)).rejects.toBeInstanceOf(
      BusStateConflictError,
    );

    // No row transitioned and the bus does not exist → not found.
    await expect(service.setBusActive('10', '999', true)).rejects.toBeInstanceOf(
      BusNotFoundError,
    );
  });
});
