import { parseStaffType, StaffType } from './staff-type';

describe('parseStaffType', () => {
  it('accepts known staff types', () => {
    expect(parseStaffType('DRIVER')).toBe(StaffType.Driver);
    expect(parseStaffType('ASSISTANT')).toBe(StaffType.Assistant);
  });

  it('returns null for an unknown value (fail closed)', () => {
    expect(parseStaffType('MANAGER')).toBeNull();
    expect(parseStaffType('')).toBeNull();
    expect(parseStaffType('driver')).toBeNull();
  });
});
