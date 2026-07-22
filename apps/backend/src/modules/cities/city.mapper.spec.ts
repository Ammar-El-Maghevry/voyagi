import { type CityRow, toCity } from './city.mapper';

describe('toCity', () => {
  it('maps a well-formed row to the domain type', () => {
    const row: CityRow = {
      id: '2',
      name_ar: 'نواكشوط',
      name_fr: 'Nouakchott',
      is_active: true,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    expect(toCity(row)).toEqual({
      id: '2',
      nameAr: 'نواكشوط',
      nameFr: 'Nouakchott',
      isActive: true,
      createdAt: row.created_at,
    });
  });
});
