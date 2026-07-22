import { TripStatus } from './trip-status';
import { type TripRow, toTrip } from './trip.mapper';

const baseRow: TripRow = {
  id: '7',
  company_id: '10',
  route_id: '3',
  bus_id: '5',
  driver_id: '2',
  assistant_id: null,
  departure_time: new Date('2026-03-01T08:00:00.000Z'),
  estimated_arrival_time: new Date('2026-03-01T13:00:00.000Z'),
  actual_departure_time: null,
  actual_arrival_time: null,
  boarding_closes_at: new Date('2026-03-01T07:30:00.000Z'),
  price_mru: '500.00',
  currency: 'MRU',
  status: 'SCHEDULED',
  is_active: true,
  version: 1,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

describe('toTrip', () => {
  it('maps a row, parses price, and normalizes nulls', () => {
    const trip = toTrip(baseRow);
    expect(trip).toMatchObject({
      id: '7',
      companyId: '10',
      routeId: '3',
      busId: '5',
      driverId: '2',
      priceMru: 500,
      status: TripStatus.Scheduled,
      version: 1,
    });
    expect(trip?.assistantId).toBeUndefined();
    expect(trip?.actualDepartureTime).toBeUndefined();
    expect(trip?.actualArrivalTime).toBeUndefined();
  });

  it('returns null for an unrecognized status (fail closed)', () => {
    expect(toTrip({ ...baseRow, status: 'DEPARTED' })).toBeNull();
  });
});
