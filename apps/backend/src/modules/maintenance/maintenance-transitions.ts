import { MaintenanceStatus } from './maintenance-status';

/** The only lifecycle actions exposed by the maintenance API. */
export enum MaintenanceAction {
  Start = 'start',
  Complete = 'complete',
  Cancel = 'cancel',
}

export interface MaintenanceTransition {
  readonly from: ReadonlySet<MaintenanceStatus>;
  readonly to: MaintenanceStatus;
  readonly stampsCompletedAt: boolean;
}

export const MAINTENANCE_TRANSITIONS: Readonly<
  Record<MaintenanceAction, MaintenanceTransition>
> = Object.freeze({
  [MaintenanceAction.Start]: {
    from: new Set([MaintenanceStatus.Scheduled]),
    to: MaintenanceStatus.InProgress,
    stampsCompletedAt: false,
  },
  [MaintenanceAction.Complete]: {
    from: new Set([MaintenanceStatus.InProgress]),
    to: MaintenanceStatus.Completed,
    stampsCompletedAt: true,
  },
  [MaintenanceAction.Cancel]: {
    from: new Set([MaintenanceStatus.Scheduled, MaintenanceStatus.InProgress]),
    to: MaintenanceStatus.Cancelled,
    stampsCompletedAt: false,
  },
});
