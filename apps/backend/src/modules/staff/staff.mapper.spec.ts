import { StaffType } from './staff-type';
import { toStaffMember, type StaffMemberRow } from './staff.mapper';

const baseRow: StaffMemberRow = {
  id: '7',
  company_id: '10',
  full_name: 'Sidi Driver',
  phone: null,
  staff_type: 'DRIVER',
  is_active: true,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

describe('toStaffMember', () => {
  it('maps a row to the domain type', () => {
    expect(toStaffMember(baseRow)).toMatchObject({
      id: '7',
      companyId: '10',
      fullName: 'Sidi Driver',
      phone: undefined,
      staffType: StaffType.Driver,
      isActive: true,
    });
  });

  it('returns null for an unknown staff_type (fail closed)', () => {
    expect(toStaffMember({ ...baseRow, staff_type: 'PILOT' })).toBeNull();
  });
});
