/**
 * A seat layout (`public.seat_layouts`) — a global, reusable template shared
 * across all tenants (buses reference one via `seat_layout_id`). The set of
 * seats is the list of canonical seat-number strings stored inside the
 * `layout_grid` jsonb; there is no separate seat table, so a layout is a single
 * row. Readable by any authenticated user (RLS `seat_layouts_read`).
 */
export interface SeatLayout {
  readonly id: string;
  readonly name: string;
  readonly totalSeats: number;
  /** Canonical seat labels, extracted from `layout_grid`. */
  readonly seatNumbers: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
