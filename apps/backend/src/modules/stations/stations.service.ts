import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { parsePositiveBigInt } from '../identity/identifier.util';
import { StationNotFoundError } from './station.errors';
import type { Station } from './station.types';
import {
  STATIONS_REPOSITORY,
  type PagedResult,
  type StationsRepository,
} from './stations.repository';

const EMPTY_PAGE: PagedResult<Station> = { items: [], total: 0 };

/**
 * Application service for stations (city-scoped reference data).
 *
 * Read-only: any authenticated caller may list/read active stations, optionally
 * filtered by city. Ids are validated before any query so a malformed value
 * fails closed (empty page / `404`) instead of reaching the database as a
 * `22P02` → `500`.
 */
@Injectable()
export class StationsService {
  constructor(
    @Inject(STATIONS_REPOSITORY)
    private readonly repository: StationsRepository,
  ) {}

  /** A page of active stations, optionally restricted to one city. */
  listStations(
    pagination: ResolvedPagination,
    cityId?: string,
  ): Promise<PagedResult<Station>> {
    if (cityId !== undefined) {
      const normalizedCityId = parsePositiveBigInt(cityId);
      if (normalizedCityId === null) {
        return Promise.resolve(EMPTY_PAGE);
      }
      return this.repository.listActive(pagination, normalizedCityId);
    }
    return this.repository.listActive(pagination);
  }

  /** A single active station, or {@link StationNotFoundError}. */
  async getStation(stationId: string): Promise<Station> {
    const normalizedStationId = parsePositiveBigInt(stationId);
    if (normalizedStationId === null) {
      throw new StationNotFoundError();
    }
    const station = await this.repository.findActiveById(normalizedStationId);
    if (!station) {
      throw new StationNotFoundError();
    }
    return station;
  }
}
