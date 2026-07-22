import {
  extractSeatNumbers,
  type SeatLayoutRow,
  toSeatLayout,
} from './seat-layout.mapper';

describe('extractSeatNumbers', () => {
  it('reads a bare array of labels', () => {
    expect(extractSeatNumbers(['1', '2', '3'])).toEqual(['1', '2', '3']);
  });

  it('reads the seat_numbers key of an object grid', () => {
    expect(
      extractSeatNumbers({ columns: 4, aisle_after: 2, seat_numbers: ['1A', '1B'] }),
    ).toEqual(['1A', '1B']);
  });

  it('coerces non-string labels to strings', () => {
    expect(extractSeatNumbers([1, 2])).toEqual(['1', '2']);
  });

  it('yields an empty list for an unrecognized shape (fail soft)', () => {
    expect(extractSeatNumbers(null)).toEqual([]);
    expect(extractSeatNumbers({})).toEqual([]);
    expect(extractSeatNumbers(42)).toEqual([]);
  });
});

describe('toSeatLayout', () => {
  const row: SeatLayoutRow = {
    id: '3',
    name: 'Demo 2+2 / 40 seats',
    total_seats: 40,
    layout_grid: { columns: 4, seat_numbers: ['1', '2'] },
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-02T00:00:00.000Z'),
  };

  it('maps a row and extracts its seat labels', () => {
    expect(toSeatLayout(row)).toEqual({
      id: '3',
      name: 'Demo 2+2 / 40 seats',
      totalSeats: 40,
      seatNumbers: ['1', '2'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  });
});
