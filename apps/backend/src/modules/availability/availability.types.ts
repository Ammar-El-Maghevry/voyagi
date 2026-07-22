/** Public company identity approved for trip discovery. */
export interface PublicCompany {
  readonly id: string;
  readonly name: string;
  readonly logoUrl: string | null;
}

/** Public station identity approved for trip discovery. */
export interface PublicStation {
  readonly id: string;
  readonly nameAr: string;
  readonly nameFr: string;
}

/** A scheduled trip projected for unauthenticated discovery. */
export interface PublicTripSearchItem {
  readonly tripId: string;
  readonly company: PublicCompany;
  readonly originStation: PublicStation;
  readonly destinationStation: PublicStation;
  readonly departureTime: Date;
  readonly estimatedArrivalTime: Date;
  /** PostgreSQL numeric value retained as a decimal string. */
  readonly estimatedPrice: string;
  readonly currency: string;
  readonly availableSeatCount: number;
}

export enum SeatAvailabilityStatus {
  Available = 'AVAILABLE',
  Held = 'HELD',
  Booked = 'BOOKED',
}

export enum OccupantGender {
  Male = 'MALE',
  Female = 'FEMALE',
  Unspecified = 'UNSPECIFIED',
}

/** Privacy-safe seat state. Seat ids are canonical labels from the layout. */
export interface PublicSeatAvailability {
  readonly seatId: string;
  readonly label: string;
  readonly status: SeatAvailabilityStatus;
  readonly occupantGender: OccupantGender | null;
}

export interface PublicTripAvailability {
  readonly tripId: string;
  readonly totalSeatCount: number;
  readonly availableSeatCount: number;
  readonly seats: readonly PublicSeatAvailability[];
}

export interface PublicTripPricePreview {
  readonly tripId: string;
  /** Authoritative unit-price trip snapshot represented as a decimal string. */
  readonly estimatedUnitPrice: string;
  readonly passengerCount: number;
  /** PostgreSQL numeric unit price multiplied by the validated passenger count. */
  readonly estimatedTotal: string;
  readonly currency: string;
  readonly isEstimate: true;
}
