import { TripEventType } from './trip-event.types';
import { TripStatus } from './trip-status';

/**
 * The documented lifecycle actions (doc 18 Phase 9: start / complete / cancel).
 * No other transition endpoint is defined, so none is offered.
 */
export enum TripAction {
  Start = 'start',
  Complete = 'complete',
  Cancel = 'cancel',
}

/** Whether an action records an actual departure/arrival timestamp. */
export type TripTimestampField = 'actual_departure_time' | 'actual_arrival_time' | null;

/** One entry of the centralized transition matrix. */
export interface TripTransition {
  /** Statuses from which the action is allowed. */
  readonly from: ReadonlySet<TripStatus>;
  /** Resulting status. */
  readonly to: TripStatus;
  /** Event appended when the action succeeds. */
  readonly event: TripEventType;
  /** Server-controlled timestamp stamped by the action, if any. */
  readonly stamps: TripTimestampField;
}

/**
 * Centralized trip transition matrix, derived strictly from the documented
 * lifecycle endpoints and `trip_status_enum`:
 *
 * - `start`:    SCHEDULED → ONGOING    (records actual departure; event DEPARTED)
 * - `complete`: ONGOING   → COMPLETED  (records actual arrival;   event ARRIVED)
 * - `cancel`:   SCHEDULED → CANCELLED  (event CANCELLED)
 *
 * `COMPLETED` and `CANCELLED` are terminal — no action leaves them, so an action
 * against a terminal (or otherwise wrong) state is rejected as a conflict.
 *
 * **`BOARDING` is intentionally not reachable in Phase 9.** The enum defines it
 * (with `BOARDING_OPENED`/`BOARDING_CLOSED` events) for the later boarding/
 * ticketing phase (doc 01 "closes boarding", doc 13 "boarding scans"); doc 18
 * Phase 9 documents only start/complete/cancel and no boarding action. So no
 * transition enters `BOARDING`, and — to avoid referencing an unreachable state
 * — no action lists it as a source either. The phase that introduces boarding
 * will add the entering action and extend `cancel`'s source set accordingly.
 */
export const TRIP_TRANSITIONS: Readonly<Record<TripAction, TripTransition>> =
  Object.freeze({
    [TripAction.Start]: {
      from: new Set([TripStatus.Scheduled]),
      to: TripStatus.Ongoing,
      event: TripEventType.Departed,
      stamps: 'actual_departure_time',
    },
    [TripAction.Complete]: {
      from: new Set([TripStatus.Ongoing]),
      to: TripStatus.Completed,
      event: TripEventType.Arrived,
      stamps: 'actual_arrival_time',
    },
    [TripAction.Cancel]: {
      from: new Set([TripStatus.Scheduled]),
      to: TripStatus.Cancelled,
      event: TripEventType.Cancelled,
      stamps: null,
    },
  });

/** Whether `action` may be applied to a trip currently in `current` status. */
export function canApply(action: TripAction, current: TripStatus): boolean {
  return TRIP_TRANSITIONS[action].from.has(current);
}
