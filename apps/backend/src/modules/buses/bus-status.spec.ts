import { BusStatus, parseBusStatus } from './bus-status';

describe('parseBusStatus', () => {
  it('accepts every known status', () => {
    expect(parseBusStatus('ACTIVE')).toBe(BusStatus.Active);
    expect(parseBusStatus('IN_MAINTENANCE')).toBe(BusStatus.InMaintenance);
    expect(parseBusStatus('OUT_OF_SERVICE')).toBe(BusStatus.OutOfService);
    expect(parseBusStatus('ARCHIVED')).toBe(BusStatus.Archived);
  });

  it('returns null for an unknown value (fail closed)', () => {
    expect(parseBusStatus('RETIRED')).toBeNull();
    expect(parseBusStatus('')).toBeNull();
    expect(parseBusStatus('active')).toBeNull();
  });
});
