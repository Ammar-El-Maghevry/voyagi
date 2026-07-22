/**
 * Operational status of a bus, mirroring the database `public.bus_status_enum`.
 * Kept as a small closed set the application understands; an unrecognized value
 * is dropped (fail closed), never coerced to a default.
 *
 * Transitions are maintenance-driven (opening a maintenance record moves a bus
 * to `IN_MAINTENANCE`, closing it restores the prior status — see
 * `12-business-rules.md` §3). That coupling belongs to the maintenance domain,
 * which is out of scope for this phase, so `status` is not mutated through the
 * fleet endpoints here; a new bus defaults to `ACTIVE`.
 */
export enum BusStatus {
  Active = 'ACTIVE',
  InMaintenance = 'IN_MAINTENANCE',
  OutOfService = 'OUT_OF_SERVICE',
  Archived = 'ARCHIVED',
}

const BUS_STATUSES: ReadonlySet<string> = new Set(Object.values(BusStatus));

/** Parse a raw bus-status string, or `null` when it is not a known value. */
export function parseBusStatus(value: string): BusStatus | null {
  return BUS_STATUSES.has(value) ? (value as BusStatus) : null;
}
