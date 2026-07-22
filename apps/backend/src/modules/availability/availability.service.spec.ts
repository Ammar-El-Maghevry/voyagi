import { resolvePagination } from '../../common/pagination/pagination';
import { ValidationException } from '../../common/validation/validation.exception';
import { PublicTripNotFoundError } from './availability.errors';
import type {
  AvailabilityRepository,
  PagedResult,
  PublicTripSearchFilter,
} from './availability.repository';
import { AvailabilityService } from './availability.service';
import type {
  PublicTripAvailability,
  PublicTripPricePreview,
  PublicTripSearchItem,
} from './availability.types';
import { SeatAvailabilityStatus } from './availability.types';

class FakeAvailabilityRepository implements AvailabilityRepository {
  searchFilter: PublicTripSearchFilter | null = null;
  availability: PublicTripAvailability | null = null;
  preview: PublicTripPricePreview | null = null;
  tripReads: string[] = [];

  searchPublicTrips(
    filter: PublicTripSearchFilter,
  ): Promise<PagedResult<PublicTripSearchItem>> {
    this.searchFilter = filter;
    return Promise.resolve({ items: [], total: 0 });
  }

  findPublicAvailability(
    tripId: string,
  ): Promise<PublicTripAvailability | null> {
    this.tripReads.push(tripId);
    return Promise.resolve(this.availability);
  }

  findPublicPricePreview(
    tripId: string,
  ): Promise<PublicTripPricePreview | null> {
    this.tripReads.push(tripId);
    return Promise.resolve(this.preview);
  }
}

describe('AvailabilityService', () => {
  let repository: FakeAvailabilityRepository;
  let service: AvailabilityService;

  beforeEach(() => {
    repository = new FakeAvailabilityRepository();
    service = new AvailabilityService(repository);
  });

  it('turns the requested date into an exact UTC half-open range', async () => {
    await service.searchTrips('1', '2', '2026-07-22', resolvePagination());

    expect(repository.searchFilter).toMatchObject({
      originStationId: '1',
      destinationStationId: '2',
      departureFrom: new Date('2026-07-22T00:00:00.000Z'),
      departureBefore: new Date('2026-07-23T00:00:00.000Z'),
    });
  });

  it('rejects malformed direct-call input before repository access', async () => {
    await expect(
      service.searchTrips('0', '2', '2026-02-30', resolvePagination()),
    ).rejects.toBeInstanceOf(ValidationException);
    await expect(
      service.getAvailability('9223372036854775808'),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(repository.searchFilter).toBeNull();
    expect(repository.tripReads).toEqual([]);
  });

  it('uses the same non-oracular 404 for ineligible availability and price reads', async () => {
    await expect(service.getAvailability('7')).rejects.toBeInstanceOf(
      PublicTripNotFoundError,
    );
    await expect(service.getPricePreview('7')).rejects.toBeInstanceOf(
      PublicTripNotFoundError,
    );
  });

  it('returns the repository public projections unchanged', async () => {
    repository.availability = {
      tripId: '7',
      totalSeatCount: 1,
      availableSeatCount: 1,
      seats: [
        {
          seatId: '1A',
          label: '1A',
          status: SeatAvailabilityStatus.Available,
          occupantGender: null,
        },
      ],
    };
    repository.preview = {
      tripId: '7',
      estimatedUnitPrice: '500.00',
      passengerCount: 1,
      estimatedTotal: '500.00',
      currency: 'MRU',
      isEstimate: true,
    };

    expect(await service.getAvailability('7')).toBe(repository.availability);
    expect(await service.getPricePreview('7')).toBe(repository.preview);
  });
});
