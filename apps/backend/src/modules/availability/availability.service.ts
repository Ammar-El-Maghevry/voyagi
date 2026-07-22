import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { ValidationException } from '../../common/validation/validation.exception';
import { PublicTripNotFoundError } from './availability.errors';
import {
  AVAILABILITY_REPOSITORY,
  type AvailabilityRepository,
  type PagedResult,
} from './availability.repository';
import type {
  PublicTripAvailability,
  PublicTripPricePreview,
  PublicTripSearchItem,
} from './availability.types';
import { isPositiveBigInt, isYyyyMmDd } from './request.validators';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(AVAILABILITY_REPOSITORY)
    private readonly repository: AvailabilityRepository,
  ) {}

  async searchTrips(
    originStationId: string,
    destinationStationId: string,
    date: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<PublicTripSearchItem>> {
    const fields: Record<string, string[]> = {};
    if (!isPositiveBigInt(originStationId)) {
      fields.originStationId = [
        'originStationId must be a positive bigint id.',
      ];
    }
    if (!isPositiveBigInt(destinationStationId)) {
      fields.destinationStationId = [
        'destinationStationId must be a positive bigint id.',
      ];
    }
    if (!isYyyyMmDd(date)) {
      fields.date = ['date must be a valid date in YYYY-MM-DD format.'];
    }
    if (Object.keys(fields).length > 0) {
      throw new ValidationException(fields);
    }

    const departureFrom = new Date(`${date}T00:00:00.000Z`);
    return this.repository.searchPublicTrips(
      {
        originStationId,
        destinationStationId,
        departureFrom,
        departureBefore: new Date(departureFrom.getTime() + DAY_MS),
      },
      pagination,
    );
  }

  async getAvailability(tripId: string): Promise<PublicTripAvailability> {
    const normalized = this.publicTripId(tripId);
    const availability =
      await this.repository.findPublicAvailability(normalized);
    if (!availability) {
      throw new PublicTripNotFoundError();
    }
    return availability;
  }

  async getPricePreview(
    tripId: string,
    passengerCount = 1,
  ): Promise<PublicTripPricePreview> {
    const normalized = this.publicTripId(tripId);
    if (!Number.isInteger(passengerCount) || passengerCount < 1 || passengerCount > 20) {
      throw new ValidationException({
        passengerCount: ['passengerCount must be an integer between 1 and 20.'],
      });
    }
    const preview = await this.repository.findPublicPricePreview(
      normalized,
      passengerCount,
    );
    if (!preview) {
      throw new PublicTripNotFoundError();
    }
    return preview;
  }

  private publicTripId(tripId: string): string {
    if (!isPositiveBigInt(tripId)) {
      throw new ValidationException({
        tripId: ['tripId must be a positive bigint id.'],
      });
    }
    return tripId;
  }
}
