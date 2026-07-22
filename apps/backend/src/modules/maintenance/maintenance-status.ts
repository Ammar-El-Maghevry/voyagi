/** Lifecycle values supported by `public.maintenance_status_enum`. */
export enum MaintenanceStatus {
  Scheduled = 'SCHEDULED',
  InProgress = 'IN_PROGRESS',
  Completed = 'COMPLETED',
  Cancelled = 'CANCELLED',
}

const MAINTENANCE_STATUSES: ReadonlySet<string> = new Set(Object.values(MaintenanceStatus));

export function parseMaintenanceStatus(value: string): MaintenanceStatus | null {
  return MAINTENANCE_STATUSES.has(value) ? (value as MaintenanceStatus) : null;
}
