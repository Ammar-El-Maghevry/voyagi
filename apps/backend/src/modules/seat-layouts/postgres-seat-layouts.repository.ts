import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { DatabaseService } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import {
  SEAT_LAYOUT_COLUMNS,
  type SeatLayoutRow,
  toSeatLayout,
} from './seat-layout.mapper';
import type {
  PagedResult,
  SeatLayoutsRepository,
} from './seat-layouts.repository';
import type { SeatLayout } from './seat-layout.types';

/**
 * PostgreSQL adapter for seat layouts. Every statement is parameterized and
 * selects explicit columns in a stable order. Seat layouts are global
 * templates, so there is no tenant predicate.
 */
@Injectable()
export class PostgresSeatLayoutsRepository implements SeatLayoutsRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseExecutor,
  ) {}

  async listAll(
    pagination: ResolvedPagination,
  ): Promise<PagedResult<SeatLayout>> {
    const rows = await this.database.query<SeatLayoutRow>(
      `SELECT ${SEAT_LAYOUT_COLUMNS}
         FROM public.seat_layouts
         ORDER BY id
         LIMIT $1 OFFSET $2`,
      [pagination.limit, pagination.offset],
      { name: 'seat_layouts.list' },
    );
    const total = await this.count(
      `SELECT count(*)::text AS total FROM public.seat_layouts`,
      [],
      'seat_layouts.count',
    );
    return { items: rows.rows.map(toSeatLayout), total };
  }

  async findById(seatLayoutId: string): Promise<SeatLayout | null> {
    const result = await this.database.query<SeatLayoutRow>(
      `SELECT ${SEAT_LAYOUT_COLUMNS}
         FROM public.seat_layouts
         WHERE id = $1`,
      [seatLayoutId],
      { name: 'seat_layouts.find' },
    );
    const row = result.rows[0];
    return row ? toSeatLayout(row) : null;
  }

  private async count(
    text: string,
    params: readonly unknown[],
    name: string,
  ): Promise<number> {
    const result = await this.database.query<{ total: string }>(text, params, {
      name,
    });
    return Number(result.rows[0]?.total ?? 0);
  }
}
