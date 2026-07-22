import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { parsePositiveBigInt } from '../identity/identifier.util';
import { SeatLayoutNotFoundError } from './seat-layout.errors';
import type { SeatLayout } from './seat-layout.types';
import {
  SEAT_LAYOUTS_REPOSITORY,
  type PagedResult,
  type SeatLayoutsRepository,
} from './seat-layouts.repository';

/**
 * Application service for seat layouts (global templates).
 *
 * Read-only: any authenticated caller may list/read layouts. Ids are validated
 * before any query so a malformed value fails closed (`404`) instead of
 * reaching the database as a `22P02` → `500`.
 */
@Injectable()
export class SeatLayoutsService {
  constructor(
    @Inject(SEAT_LAYOUTS_REPOSITORY)
    private readonly repository: SeatLayoutsRepository,
  ) {}

  /** A page of seat layouts. */
  listSeatLayouts(
    pagination: ResolvedPagination,
  ): Promise<PagedResult<SeatLayout>> {
    return this.repository.listAll(pagination);
  }

  /** A single seat layout, or {@link SeatLayoutNotFoundError}. */
  async getSeatLayout(seatLayoutId: string): Promise<SeatLayout> {
    const normalizedId = parsePositiveBigInt(seatLayoutId);
    if (normalizedId === null) {
      throw new SeatLayoutNotFoundError();
    }
    const layout = await this.repository.findById(normalizedId);
    if (!layout) {
      throw new SeatLayoutNotFoundError();
    }
    return layout;
  }
}
