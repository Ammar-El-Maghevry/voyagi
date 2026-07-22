import type { SeatLayout } from './seat-layout.types';

/**
 * Raw `seat_layouts` row. `id` arrives as a string from `pg`; `total_seats` is
 * an integer; `layout_grid` is parsed jsonb — either an array of seat labels or
 * an object carrying a `seat_numbers` array (plus optional presentation
 * metadata such as `columns`/`aisle_after`).
 */
export interface SeatLayoutRow {
  id: string;
  name: string;
  total_seats: number;
  layout_grid: unknown;
  created_at: Date;
  updated_at: Date;
}

/** Explicit, non-`SELECT *` column list (aligned with {@link SeatLayoutRow}). */
export const SEAT_LAYOUT_COLUMNS =
  'id, name, total_seats, layout_grid, created_at, updated_at';

/**
 * Extract the canonical seat labels from a `layout_grid` value, mirroring the
 * database `seat_layout_numbers` helper: a bare array is the label list; an
 * object exposes them under `seat_numbers`. Anything else yields an empty list
 * (fail soft — the caller decides what an empty layout means).
 */
export function extractSeatNumbers(layoutGrid: unknown): string[] {
  const source = Array.isArray(layoutGrid)
    ? layoutGrid
    : isRecord(layoutGrid) && Array.isArray(layoutGrid.seat_numbers)
      ? layoutGrid.seat_numbers
      : [];
  return source.map((value) => String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toSeatLayout(row: SeatLayoutRow): SeatLayout {
  return {
    id: row.id,
    name: row.name,
    totalSeats: row.total_seats,
    seatNumbers: extractSeatNumbers(row.layout_grid),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
