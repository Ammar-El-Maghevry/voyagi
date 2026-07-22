import { BusStatus } from './bus-status';
import { type BusRow, toBus } from './bus.mapper';

const baseRow: BusRow = {
  id: '5',
  company_id: '10',
  seat_layout_id: '3',
  plate_number: 'ABC-123',
  bus_model: 'Coach X',
  status: 'ACTIVE',
  is_active: true,
  current_odometer_km: 1200,
  version: 1,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-02T00:00:00.000Z'),
};

describe('toBus', () => {
  it('maps a well-formed row to the domain type', () => {
    expect(toBus(baseRow)).toEqual({
      id: '5',
      companyId: '10',
      seatLayoutId: '3',
      plateNumber: 'ABC-123',
      busModel: 'Coach X',
      status: BusStatus.Active,
      isActive: true,
      currentOdometerKm: 1200,
      version: 1,
      createdAt: baseRow.created_at,
      updatedAt: baseRow.updated_at,
    });
  });

  it('normalizes a null bus_model to undefined', () => {
    expect(toBus({ ...baseRow, bus_model: null })?.busModel).toBeUndefined();
  });

  it('returns null for an unrecognized status (fail closed)', () => {
    expect(toBus({ ...baseRow, status: 'RETIRED' })).toBeNull();
  });
});
