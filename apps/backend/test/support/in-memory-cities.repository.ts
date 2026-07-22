import type { ResolvedPagination } from '../../src/common/pagination/pagination';
import type {
  CitiesRepository,
  PagedResult,
} from '../../src/modules/cities/cities.repository';
import type { City } from '../../src/modules/cities/city.types';

interface SeedCity {
  id: string;
  nameAr: string;
  nameFr: string;
  isActive?: boolean;
}

/**
 * In-memory {@link CitiesRepository} for e2e tests. Preserves the SQL adapter's
 * observable semantics — active-only reads in a stable id order — without a
 * real database.
 */
export class InMemoryCitiesRepository implements CitiesRepository {
  private readonly cities: City[] = [];
  private failWith: Error | null = null;

  addCity(seed: SeedCity): void {
    this.cities.push({
      id: seed.id,
      nameAr: seed.nameAr,
      nameFr: seed.nameFr,
      isActive: seed.isActive ?? true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
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

  private active(): City[] {
    return this.cities
      .filter((c) => c.isActive)
      .sort((a, b) => Number(a.id) - Number(b.id));
  }

  listActive(pagination: ResolvedPagination): Promise<PagedResult<City>> {
    this.maybeFail();
    const all = this.active();
    const page = all.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );
    return Promise.resolve({ items: page, total: all.length });
  }

  findActiveById(cityId: string): Promise<City | null> {
    this.maybeFail();
    return Promise.resolve(
      this.active().find((c) => c.id === cityId) ?? null,
    );
  }
}
