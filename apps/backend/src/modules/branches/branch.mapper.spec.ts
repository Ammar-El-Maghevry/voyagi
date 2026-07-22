import { toBranch, type BranchRow } from './branch.mapper';

const baseRow: BranchRow = {
  id: '100',
  company_id: '10',
  city_id: '5',
  name_ar: 'فرع',
  name_fr: 'Agence',
  phone: '+22212345678',
  is_active: true,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-02T00:00:00.000Z'),
};

describe('toBranch', () => {
  it('maps a row to the domain type', () => {
    expect(toBranch(baseRow)).toEqual({
      id: '100',
      companyId: '10',
      cityId: '5',
      nameAr: 'فرع',
      nameFr: 'Agence',
      phone: '+22212345678',
      isActive: true,
      createdAt: baseRow.created_at,
      updatedAt: baseRow.updated_at,
    });
  });

  it('normalizes a null phone to undefined', () => {
    expect(toBranch({ ...baseRow, phone: null }).phone).toBeUndefined();
  });
});
