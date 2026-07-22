import { type StationRow, toStation } from './station.mapper';

const baseRow: StationRow = {
  id: '7',
  city_id: '2',
  name_ar: 'محطة',
  name_fr: 'Gare',
  latitude: '18.079000',
  longitude: '-15.965000',
  is_active: true,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-02T00:00:00.000Z'),
};

describe('toStation', () => {
  it('maps a row and parses numeric coordinates', () => {
    const station = toStation(baseRow);
    expect(station).toMatchObject({
      id: '7',
      cityId: '2',
      nameAr: 'محطة',
      nameFr: 'Gare',
      latitude: 18.079,
      longitude: -15.965,
      isActive: true,
    });
  });

  it('normalizes null coordinates to undefined', () => {
    const station = toStation({ ...baseRow, latitude: null, longitude: null });
    expect(station.latitude).toBeUndefined();
    expect(station.longitude).toBeUndefined();
  });
});
