import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import type { ResolvedPagination } from '../src/common/pagination/pagination';
import {
  AVAILABILITY_REPOSITORY,
  type AvailabilityRepository,
  type PagedResult,
  type PublicTripSearchFilter,
} from '../src/modules/availability/availability.repository';
import type {
  PublicTripAvailability,
  PublicTripPricePreview,
  PublicTripSearchItem,
} from '../src/modules/availability/availability.types';

class FakeAvailabilityRepository implements AvailabilityRepository {
  readonly searchCalls: Array<{
    filter: PublicTripSearchFilter;
    pagination: ResolvedPagination;
  }> = [];
  readonly previewCalls: Array<{ tripId: string; passengerCount: number }> = [];

  private readonly trips: readonly PublicTripSearchItem[] = [
    this.trip('100', '2026-07-22T08:00:00.000Z'),
    this.trip('101', '2026-07-22T09:00:00.000Z'),
    this.trip('102', '2026-07-22T10:00:00.000Z'),
  ];

  searchPublicTrips(
    filter: PublicTripSearchFilter,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<PublicTripSearchItem>> {
    this.searchCalls.push({ filter, pagination });
    return Promise.resolve({
      items: this.trips.slice(
        pagination.offset,
        pagination.offset + pagination.limit,
      ),
      total: this.trips.length,
    });
  }

  findPublicAvailability(
    tripId: string,
  ): Promise<PublicTripAvailability | null> {
    if (tripId !== '100') return Promise.resolve(null);
    return Promise.resolve({
      tripId,
      totalSeatCount: 2,
      availableSeatCount: 1,
      seats: [
        {
          seatId: '1A',
          label: '1A',
          status: 'BOOKED',
          occupantGender: 'FEMALE',
          fullName: 'must never leave the controller',
          phone: '+22236000000',
        },
        {
          seatId: '1B',
          label: '1B',
          status: 'AVAILABLE',
          occupantGender: null,
        },
      ],
      bookingReference: 'PRIVATE-REFERENCE',
    } as unknown as PublicTripAvailability);
  }

  findPublicPricePreview(
    tripId: string,
    passengerCount: number,
  ): Promise<PublicTripPricePreview | null> {
    this.previewCalls.push({ tripId, passengerCount });
    if (tripId !== '100') return Promise.resolve(null);
    return Promise.resolve({
      tripId,
      estimatedUnitPrice: '123.45',
      passengerCount,
      estimatedTotal: (123.45 * passengerCount).toFixed(2),
      currency: 'MRU',
      isEstimate: true,
      internalPricingRule: 'PRIVATE',
    } as unknown as PublicTripPricePreview);
  }

  private trip(id: string, departureTime: string): PublicTripSearchItem {
    return {
      tripId: id,
      company: {
        id: '10',
        name: 'Voyagi',
        logoUrl: null,
        contactPhone: '+22299999999',
      },
      originStation: {
        id: '1',
        nameAr: 'نواكشوط',
        nameFr: 'Nouakchott',
        latitude: '18.0735',
      },
      destinationStation: {
        id: '2',
        nameAr: 'كيفه',
        nameFr: 'Kiffa',
        longitude: '-7.2565',
      },
      departureTime: new Date(departureTime),
      estimatedArrivalTime: new Date(
        new Date(departureTime).getTime() + 3 * 60 * 60 * 1_000,
      ),
      estimatedPrice: '123.45',
      currency: 'MRU',
      availableSeatCount: 1,
      busId: '700',
      driverId: '800',
    } as unknown as PublicTripSearchItem;
  }
}

describe('Public availability HTTP API (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let repository: FakeAvailabilityRepository;

  beforeAll(async () => {
    repository = new FakeAvailabilityRepository();
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AVAILABILITY_REPOSITORY)
      .useValue(repository)
      .compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app as never);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const searchPath =
    '/api/v1/trips/search?originStationId=1&destinationStationId=2&date=2026-07-22';

  it('keeps search, availability, and preview public through the real guard pipeline', async () => {
    const searchResponse = await request(app.getHttpServer()).get(searchPath);
    const availabilityResponse = await request(app.getHttpServer())
      .get('/api/v1/trips/100/availability')
      .set('Authorization', 'Bearer definitely-not-a-jwt');
    const previewResponse = await request(app.getHttpServer()).get(
      '/api/v1/trips/100/price-preview',
    );

    expect(searchResponse.status).toBe(200);
    expect(availabilityResponse.status).toBe(200);
    expect(previewResponse.status).toBe(200);
  });

  it('validates search DTO fields and rejects unknown query properties', async () => {
    for (const path of [
      '/api/v1/trips/search?originStationId=0&destinationStationId=2&date=2026-07-22',
      '/api/v1/trips/search?originStationId=1&destinationStationId=nope&date=2026-07-22',
      '/api/v1/trips/search?originStationId=1&destinationStationId=2&date=2026-02-30',
      `${searchPath}&privateFilter=true`,
      '/api/v1/trips/search?originStationId=1&destinationStationId=2',
    ]) {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.fields).toBeDefined();
    }
  });

  it('returns the standard pagination envelope and passes UTC day bounds to the repository', async () => {
    const response = await request(app.getHttpServer()).get(
      `${searchPath}&page=2&pageSize=2`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: [{ tripId: '102' }],
      meta: { page: 2, pageSize: 2, total: 3, totalPages: 2 },
    });
    expect(typeof response.body.requestId).toBe('string');
    expect(repository.searchCalls.at(-1)).toEqual({
      filter: {
        originStationId: '1',
        destinationStationId: '2',
        departureFrom: new Date('2026-07-22T00:00:00.000Z'),
        departureBefore: new Date('2026-07-23T00:00:00.000Z'),
      },
      pagination: { page: 2, pageSize: 2, limit: 2, offset: 2 },
    });
  });

  it('allowlists every public response instead of serializing extra repository fields', async () => {
    const searchResponse = await request(app.getHttpServer()).get(searchPath);
    const availabilityResponse = await request(app.getHttpServer()).get(
      '/api/v1/trips/100/availability',
    );
    const previewResponse = await request(app.getHttpServer()).get(
      '/api/v1/trips/100/price-preview?passengerCount=2',
    );

    expect(Object.keys(searchResponse.body.data[0]).sort()).toEqual([
      'availableSeatCount',
      'company',
      'currency',
      'departureTime',
      'destinationStation',
      'estimatedArrivalTime',
      'estimatedPrice',
      'originStation',
      'tripId',
    ]);
    expect(Object.keys(searchResponse.body.data[0].company).sort()).toEqual([
      'id',
      'logoUrl',
      'name',
    ]);
    expect(
      Object.keys(searchResponse.body.data[0].originStation).sort(),
    ).toEqual(['id', 'nameAr', 'nameFr']);
    expect(Object.keys(availabilityResponse.body.data).sort()).toEqual([
      'availableSeatCount',
      'seats',
      'totalSeatCount',
      'tripId',
    ]);
    expect(Object.keys(availabilityResponse.body.data.seats[0]).sort()).toEqual(
      ['label', 'occupantGender', 'seatId', 'status'],
    );
    expect(Object.keys(previewResponse.body.data).sort()).toEqual([
      'currency',
      'estimatedTotal',
      'estimatedUnitPrice',
      'isEstimate',
      'passengerCount',
      'tripId',
    ]);
    expect(
      JSON.stringify([
        searchResponse.body,
        availabilityResponse.body,
        previewResponse.body,
      ]),
    ).not.toMatch(
      /contactPhone|latitude|longitude|busId|driverId|fullName|phone|bookingReference|internalPricingRule|PRIVATE/i,
    );
  });

  it('defaults passengerCount to one and accepts both documented boundaries', async () => {
    for (const [query, expected] of [
      ['', 1],
      ['?passengerCount=1', 1],
      ['?passengerCount=20', 20],
    ] as const) {
      const response = await request(app.getHttpServer()).get(
        `/api/v1/trips/100/price-preview${query}`,
      );
      expect(response.status).toBe(200);
      expect(response.body.data.passengerCount).toBe(expected);
      expect(repository.previewCalls.at(-1)).toEqual({
        tripId: '100',
        passengerCount: expected,
      });
    }
  });

  it('rejects passengerCount outside 1..20 and non-integer values', async () => {
    for (const passengerCount of ['0', '21', '1.5', 'not-a-number']) {
      const response = await request(app.getHttpServer()).get(
        `/api/v1/trips/100/price-preview?passengerCount=${passengerCount}`,
      );
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.fields.passengerCount).toBeDefined();
    }
  });

  it('uses the same safe 404 envelope for missing availability and price preview', async () => {
    for (const path of [
      '/api/v1/trips/999/availability',
      '/api/v1/trips/999/price-preview',
    ]) {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.status).toBe(404);
      expect(response.body.error).toEqual({
        code: 'RESOURCE_NOT_FOUND',
        message: 'The requested trip was not found.',
      });
      expect(JSON.stringify(response.body)).not.toContain('999 is ineligible');
    }
  });
});
