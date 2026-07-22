import type { ResolvedPagination } from '../../src/common/pagination/pagination';
import type {
  PagedResult,
  SeatLayoutsRepository,
} from '../../src/modules/seat-layouts/seat-layouts.repository';
import type { SeatLayout } from '../../src/modules/seat-layouts/seat-layout.types';

interface SeedSeatLayout {
  id: string;
  name: string;
  totalSeats: number;
  seatNumbers: string[];
}

/**
 * In-memory {@link SeatLayoutsRepository} for e2e tests. Preserves the SQL
 * adapter's observable semantics — stable id order — without a real database.
 */
export class InMemorySeatLayoutsRepository implements SeatLayoutsRepository {
  private readonly layouts: SeatLayout[] = [];
  private failWith: Error | null = null;

  addSeatLayout(seed: SeedSeatLayout): void {
    const now = new Date('2026-01-01T00:00:00.000Z');
    this.layouts.push({
      id: seed.id,
      name: seed.name,
      totalSeats: seed.totalSeats,
      seatNumbers: seed.seatNumbers,
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

  listAll(pagination: ResolvedPagination): Promise<PagedResult<SeatLayout>> {
    this.maybeFail();
    const all = [...this.layouts].sort((a, b) => Number(a.id) - Number(b.id));
    const page = all.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );
    return Promise.resolve({ items: page, total: all.length });
  }

  findById(seatLayoutId: string): Promise<SeatLayout | null> {
    this.maybeFail();
    return Promise.resolve(
      this.layouts.find((l) => l.id === seatLayoutId) ?? null,
    );
  }
}
