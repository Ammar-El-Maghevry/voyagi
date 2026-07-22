/**
 * Trip lifecycle event type, mirroring `public.trip_event_type_enum`. Only the
 * subset produced by the Phase 9 lifecycle endpoints is referenced here; the
 * remaining values (BOARDING_*, DELAYED, BUS_CHANGED, DRIVER_CHANGED) belong to
 * later phases and are never written by this module.
 */
export enum TripEventType {
  TripCreated = 'TRIP_CREATED',
  BoardingOpened = 'BOARDING_OPENED',
  BoardingClosed = 'BOARDING_CLOSED',
  Departed = 'DEPARTED',
  Delayed = 'DELAYED',
  Arrived = 'ARRIVED',
  Cancelled = 'CANCELLED',
  BusChanged = 'BUS_CHANGED',
  DriverChanged = 'DRIVER_CHANGED',
}

/**
 * Origin of a trip event, mirroring `public.trip_event_source_enum`. Lifecycle
 * actions taken by a company manager through the management API are recorded as
 * `ADMIN`.
 */
export enum TripEventSource {
  System = 'SYSTEM',
  Admin = 'ADMIN',
  Agent = 'AGENT',
  Employee = 'EMPLOYEE',
  Api = 'API',
}

/**
 * A trip event (`public.trip_events`) — an append-only lifecycle log entry.
 * Rows are immutable (a database trigger blocks update/delete); this module only
 * ever inserts them, in the same transaction as the lifecycle change they record.
 */
export interface TripEvent {
  readonly id: string;
  readonly tripId: string;
  readonly companyId: string;
  readonly actorUserId?: string;
  readonly eventType: TripEventType;
  readonly eventSource: TripEventSource;
  readonly eventTime: Date;
  readonly createdAt: Date;
}

/** Fields required to append a trip event within a lifecycle transaction. */
export interface TripEventCreate {
  readonly eventType: TripEventType;
  readonly eventSource: TripEventSource;
  readonly actorUserId?: string;
}
