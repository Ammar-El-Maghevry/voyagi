import type { MaintenanceStatus } from './maintenance-status';
import type { MaintenanceType } from './maintenance-type';

export interface MaintenanceRecord {
  readonly id: string;
  readonly companyId: string;
  readonly busId: string;
  readonly maintenanceType: MaintenanceType;
  readonly description?: string;
  readonly status: MaintenanceStatus;
  readonly costMru?: number;
  readonly odometerKm?: number;
  /** Planned start while scheduled, actual start once work begins. */
  readonly startedAt: Date;
  readonly scheduledEndsAt?: Date;
  readonly completedAt?: Date;
  readonly nextMaintenanceAt?: Date;
  readonly createdByUserId?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MaintenanceCreate {
  readonly busId: string;
  readonly maintenanceType: MaintenanceType;
  readonly description?: string;
  readonly costMru?: number;
  readonly odometerKm?: number;
  readonly startedAt: Date;
  readonly scheduledEndsAt: Date;
  readonly nextMaintenanceAt?: Date;
}

export interface LockedBus {
  readonly isActive: boolean;
  readonly status: string;
}
