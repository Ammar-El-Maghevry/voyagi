import { type RouteRow, toRoute } from './route.mapper';

const row: RouteRow = {
  id: '9',
  company_id: '10',
  origin_station_id: '1',
  destination_station_id: '2',
  default_price_mru: '500.00',
  currency: 'MRU',
  estimated_duration_minutes: 300,
  distance_km: '450.50',
  is_active: true,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-02T00:00:00.000Z'),
};

describe('toRoute', () => {
  it('maps a row and parses numeric price/distance into numbers', () => {
    expect(toRoute(row)).toEqual({
      id: '9',
      companyId: '10',
      originStationId: '1',
      destinationStationId: '2',
      defaultPriceMru: 500,
      currency: 'MRU',
      estimatedDurationMinutes: 300,
      distanceKm: 450.5,
      isActive: true,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  });
});
