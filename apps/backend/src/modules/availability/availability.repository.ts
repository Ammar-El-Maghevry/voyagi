import type { ResolvedPagination } from '../../common/pagination/pagination';
import type {
  PublicTripAvailability,
  PublicTripPricePreview,
  PublicTripSearchItem,
} from './availability.types';

export interface PublicTripSearchFilter {
  readonly originStationId: string;
  readonly destinationStationId: string;
  readonly departureFrom: Date;
  readonly departureBefore: Date;
}

export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** Overridable DI token for public availability persistence. */
export const AVAILABILITY_REPOSITORY = Symbol('AVAILABILITY_REPOSITORY');

/** Read-only persistence port for the public availability surface. */
export interface AvailabilityRepository {
  searchPublicTrips(
    filter: PublicTripSearchFilter,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<PublicTripSearchItem>>;

  findPublicAvailability(
    tripId: string,
  ): Promise<PublicTripAvailability | null>;

  findPublicPricePreview(
    tripId: string,
    passengerCount: number,
  ): Promise<PublicTripPricePreview | null>;
}
