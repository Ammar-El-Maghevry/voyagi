import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { parsePositiveBigInt } from '../identity/identifier.util';
import {
  CITIES_REPOSITORY,
  type CitiesRepository,
  type PagedResult,
} from './cities.repository';
import { CityNotFoundError } from './city.errors';
import type { City } from './city.types';

/**
 * Application service for cities (global reference data).
 *
 * Read-only: any authenticated caller may list/read active cities. Ids are
 * validated before any query so a malformed value fails closed (`404`) instead
 * of reaching the database as a `22P02` → `500`.
 */
@Injectable()
export class CitiesService {
  constructor(
    @Inject(CITIES_REPOSITORY)
    private readonly repository: CitiesRepository,
  ) {}

  /** A page of active cities. */
  listCities(pagination: ResolvedPagination): Promise<PagedResult<City>> {
    return this.repository.listActive(pagination);
  }

  /** A single active city, or {@link CityNotFoundError}. */
  async getCity(cityId: string): Promise<City> {
    const normalizedCityId = parsePositiveBigInt(cityId);
    if (normalizedCityId === null) {
      throw new CityNotFoundError();
    }
    const city = await this.repository.findActiveById(normalizedCityId);
    if (!city) {
      throw new CityNotFoundError();
    }
    return city;
  }
}
