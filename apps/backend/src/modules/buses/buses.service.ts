import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { ValidationException } from '../../common/validation/validation.exception';
import { parsePositiveBigInt } from '../identity/identifier.util';
import { BusNotFoundError, BusStateConflictError } from './bus.errors';
import type { Bus, BusCreate, BusUpdate } from './bus.types';
import {
  BUSES_REPOSITORY,
  type BusesRepository,
  type PagedResult,
} from './buses.repository';

const EMPTY_PAGE: PagedResult<Bus> = { items: [], total: 0 };

/**
 * Application service for buses (fleet).
 *
 * Buses are company-scoped: `fleet.read` (any active member) governs reads and
 * the company-wide `fleet.manage` governs writes, both enforced by the guard.
 * There is no branch dimension, so no branch-entitlement narrowing applies here.
 * Company/bus ids are validated before any query so a malformed value fails
 * closed (`404`) instead of reaching the database as a `22P02` → `500`.
 */
@Injectable()
export class BusesService {
  constructor(
    @Inject(BUSES_REPOSITORY)
    private readonly repository: BusesRepository,
  ) {}

  /** A page of the company's buses. */
  async listBuses(
    companyId: string,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<Bus>> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    if (normalizedCompanyId === null) {
      return EMPTY_PAGE;
    }
    return this.repository.listByCompany(normalizedCompanyId, pagination);
  }

  /** A single bus within the company, or {@link BusNotFoundError}. */
  async getBus(companyId: string, busId: string): Promise<Bus> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    const normalizedBusId = parsePositiveBigInt(busId);
    if (normalizedCompanyId === null || normalizedBusId === null) {
      throw new BusNotFoundError();
    }
    const bus = await this.repository.findInCompany(
      normalizedCompanyId,
      normalizedBusId,
    );
    if (!bus) {
      throw new BusNotFoundError();
    }
    return bus;
  }

  /** Create a bus for the company (requires `fleet.manage`, enforced upstream). */
  async createBus(companyId: string, input: BusCreate): Promise<Bus> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    if (normalizedCompanyId === null) {
      // A verified, guard-resolved tenant is always a valid bigint; guard closed.
      throw new BusNotFoundError();
    }
    return this.repository.create(normalizedCompanyId, input);
  }

  /** Update a bus's descriptive fields within the company. */
  async updateBus(
    companyId: string,
    busId: string,
    input: BusUpdate,
  ): Promise<Bus> {
    if (
      input.seatLayoutId === undefined &&
      input.plateNumber === undefined &&
      input.busModel === undefined &&
      input.currentOdometerKm === undefined
    ) {
      throw new ValidationException({
        body: ['At least one updatable field must be provided.'],
      });
    }
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    const normalizedBusId = parsePositiveBigInt(busId);
    if (normalizedCompanyId === null || normalizedBusId === null) {
      throw new BusNotFoundError();
    }
    const bus = await this.repository.update(
      normalizedCompanyId,
      normalizedBusId,
      input,
    );
    if (!bus) {
      throw new BusNotFoundError();
    }
    return bus;
  }

  /** Activate or deactivate a bus (atomic transition; no-op → conflict). */
  async setBusActive(
    companyId: string,
    busId: string,
    target: boolean,
  ): Promise<Bus> {
    const normalizedCompanyId = parsePositiveBigInt(companyId);
    const normalizedBusId = parsePositiveBigInt(busId);
    if (normalizedCompanyId === null || normalizedBusId === null) {
      throw new BusNotFoundError();
    }
    const transitioned = await this.repository.transitionActive(
      normalizedCompanyId,
      normalizedBusId,
      target,
    );
    if (transitioned) {
      return transitioned;
    }
    // No row changed: distinguish "already in target state" from "not here".
    const existing = await this.repository.findInCompany(
      normalizedCompanyId,
      normalizedBusId,
    );
    if (existing) {
      throw new BusStateConflictError(target);
    }
    throw new BusNotFoundError();
  }
}
