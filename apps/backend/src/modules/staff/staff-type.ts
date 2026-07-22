/**
 * Operational staff type, mirroring the database `public.staff_type_enum`.
 * Kept as a small closed set the application understands; an unrecognized value
 * is dropped (fail closed), never coerced to a default.
 */
export enum StaffType {
  Driver = 'DRIVER',
  Assistant = 'ASSISTANT',
}

const STAFF_TYPES: ReadonlySet<string> = new Set(Object.values(StaffType));

/** Parse a raw staff-type string, or `null` when it is not a known value. */
export function parseStaffType(value: string): StaffType | null {
  return STAFF_TYPES.has(value) ? (value as StaffType) : null;
}
