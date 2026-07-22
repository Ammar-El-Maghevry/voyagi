import type { DatabaseExecutor } from '../../infrastructure/database/database.types';

/**
 * Cross-domain scheduling boundary consumed by trips. Callers must first lock
 * the bus row in their transaction so maintenance and trip changes serialize.
 */
export interface MaintenanceSchedulingPort {
  hasActiveMaintenanceOverlap(
    executor: DatabaseExecutor,
    companyId: string,
    busId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<boolean>;
}

export const MAINTENANCE_SCHEDULING_PORT = Symbol('MAINTENANCE_SCHEDULING_PORT');
