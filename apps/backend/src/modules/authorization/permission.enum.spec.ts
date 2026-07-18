import { ALL_PERMISSIONS, Permission } from './permission.enum';

describe('Permission catalog', () => {
  it('uses the resource.action naming convention for every value', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(permission).toMatch(/^[a-z]+\.[a-z]+$/);
    }
  });

  it('has unique values', () => {
    const values = Object.values(Permission);
    expect(new Set(values).size).toBe(values.length);
  });

  it('exposes every enum value through ALL_PERMISSIONS', () => {
    expect([...ALL_PERMISSIONS].sort()).toEqual(Object.values(Permission).sort());
  });

  it('is frozen to prevent accidental mutation', () => {
    expect(Object.isFrozen(ALL_PERMISSIONS)).toBe(true);
  });
});
