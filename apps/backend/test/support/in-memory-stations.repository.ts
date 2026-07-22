import type { ResolvedPagination } from '../../src/common/pagination/pagination';
import type {
  PagedResult,
  StationsRepository,
} from '../../src/modules/stations/stations.repository';
import type { Station } from '../../src/modules/stations/station.types';

interface SeedStation {
  id: string;
  cityId: string;
  nameAr: string;
  nameFr: string;
  latitude?: number;
  longitude?: number;
  isActive?: boolean;
}

/**
 * In-memory {@link StationsRepository} for e2e tests. Preserves the SQL
 * adapter's observable semantics — active-only reads, optional city filter, and
 * a stable id order — without a real database.
 */
export class InMemoryStationsRepository implements StationsRepository {
  private readonly stations: Station[] = [];
  private failWith: Error | null = null;

  addStation(seed: SeedStation): void {
    const now = new Date('2026-01-01T00:00:00.000Z');
    this.stations.push({
      id: seed.id,
      cityId: seed.cityId,
      nameAr: seed.nameAr,
      nameFr: seed.nameFr,
      latitude: seed.latitude,
      longitude: seed.longitude,
      isActive: seed.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });
  }

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

  listActive(
    pagination: ResolvedPagination,
    cityId?: string,
  ): Promise<PagedResult<Station>> {
    this.maybeFail();
    const all = this.stations
      .filter((s) => s.isActive && (cityId === undefined || s.cityId === cityId))
      .sort((a, b) => Number(a.id) - Number(b.id));
    const page = all.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );
    return Promise.resolve({ items: page, total: all.length });
  }

  findActiveById(stationId: string): Promise<Station | null> {
    this.maybeFail();
    return Promise.resolve(
      this.stations.find((s) => s.id === stationId && s.isActive) ?? null,
    );
  }
}
