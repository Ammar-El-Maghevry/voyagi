import type { QueryResult, QueryResultRow } from 'pg';
import { resolvePagination } from '../../common/pagination/pagination';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { OccupantGender, SeatAvailabilityStatus } from './availability.types';
import { PostgresAvailabilityRepository } from './postgres-availability.repository';

class FakeExecutor implements DatabaseExecutor {
  readonly calls: { text: string; params: readonly unknown[] }[] = [];
  private readonly results: unknown[][] = [];

  queueRows(rows: unknown[]): void {
    this.results.push(rows);
  }

  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>> {
    this.calls.push({ text, params: params ?? [] });
    const rows = (this.results.shift() ?? []) as R[];
    return Promise.resolve({
      rows,
      command: '',
      rowCount: rows.length,
      oid: 0,
      fields: [],
    });
  }
}

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

describe('PostgresAvailabilityRepository', () => {
  let executor: FakeExecutor;
  let repository: PostgresAvailabilityRepository;

  beforeEach(() => {
    executor = new FakeExecutor();
    repository = new PostgresAvailabilityRepository(executor);
  });

  it('searches with parameters, public eligibility filters, and a narrow projection', async () => {
    executor.queueRows([
      {
        trip_id: '7',
        company_id: '10',
        company_name: 'Voyagi',
        company_logo_url: null,
        origin_station_id: '1',
        origin_name_ar: 'أ',
        origin_name_fr: 'A',
        destination_station_id: '2',
        destination_name_ar: 'ب',
        destination_name_fr: 'B',
        departure_time: new Date('2026-07-22T08:00:00.000Z'),
        estimated_arrival_time: new Date('2026-07-22T12:00:00.000Z'),
        estimated_price: '500.00',
        currency: 'MRU',
        available_seat_count: 38,
      },
    ]);
    executor.queueRows([{ total: '1' }]);

    const page = await repository.searchPublicTrips(
      {
        originStationId: '1',
        destinationStationId: '2',
        departureFrom: new Date('2026-07-22T00:00:00.000Z'),
        departureBefore: new Date('2026-07-23T00:00:00.000Z'),
      },
      resolvePagination({ page: 2, pageSize: 10 }),
    );

    const sql = normalize(executor.calls[0].text);
    expect(sql).not.toContain('SELECT *');
    expect(sql).not.toMatch(
      /driver|assistant|plate_number|bus_model|passenger/i,
    );
    expect(sql).toContain("trip.status = 'SCHEDULED'::public.trip_status_enum");
    expect(sql).toContain('trip.is_active');
    expect(sql).toContain('company.is_active AND company.archived_at IS NULL');
    expect(sql).toContain('route.is_active AND route.deleted_at IS NULL');
    expect(sql).toContain('origin.is_active AND origin.deleted_at IS NULL');
    expect(sql).toContain(
      'destination.is_active AND destination.deleted_at IS NULL',
    );
    expect(sql).toContain(
      "reservation.status = 'HELD' AND reservation.held_until > now()",
    );
    expect(executor.calls[0].params).toEqual([
      '1',
      '2',
      new Date('2026-07-22T00:00:00.000Z'),
      new Date('2026-07-23T00:00:00.000Z'),
      10,
      10,
    ]);
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      tripId: '7',
      estimatedPrice: '500.00',
      availableSeatCount: 38,
    });
  });

  it('maps only privacy-safe seat fields and derives the available count', async () => {
    executor.queueRows([
      {
        trip_id: '7',
        total_seat_count: 3,
        seat_id: '1A',
        label: '1A',
        status: SeatAvailabilityStatus.Available,
        occupant_gender: null,
      },
      {
        trip_id: '7',
        total_seat_count: 3,
        seat_id: '1B',
        label: '1B',
        status: SeatAvailabilityStatus.Held,
        occupant_gender: OccupantGender.Unspecified,
      },
      {
        trip_id: '7',
        total_seat_count: 3,
        seat_id: '1C',
        label: '1C',
        status: SeatAvailabilityStatus.Booked,
        occupant_gender: OccupantGender.Unspecified,
      },
    ]);

    const availability = await repository.findPublicAvailability('7');
    const sql = normalize(executor.calls[0].text);

    expect(executor.calls[0].params).toEqual(['7']);
    expect(sql).toContain(
      "reservation.status = 'HELD' AND reservation.held_until > now()",
    );
    expect(sql).toMatch(/passenger\.gender::text AS occupant_gender/i);
    expect(sql).toContain('passenger.id = reservation.passenger_id');
    expect(sql).toContain('passenger.booking_id = reservation.booking_id');
    expect(sql).toContain('route.company_id = trip.company_id');
    expect(sql).toMatch(/where trip\.id = \$1/i);
    const projection = sql.slice(0, sql.indexOf(' FROM '));
    expect(projection).not.toMatch(
      /passenger\.id|booking_id|profile_id|booking_reference|full_name|phone|document_number|date_of_birth|birth_date/i,
    );
    expect(availability).toMatchObject({
      tripId: '7',
      totalSeatCount: 3,
      availableSeatCount: 1,
    });
    expect(Object.keys(availability!.seats[0]).sort()).toEqual([
      'label',
      'occupantGender',
      'seatId',
      'status',
    ]);
    expect(availability!.seats).toEqual([
      {
        seatId: '1A',
        label: '1A',
        status: 'AVAILABLE',
        occupantGender: null,
      },
      {
        seatId: '1B',
        label: '1B',
        status: 'HELD',
        occupantGender: 'UNSPECIFIED',
      },
      {
        seatId: '1C',
        label: '1C',
        status: 'BOOKED',
        occupantGender: 'UNSPECIFIED',
      },
    ]);
  });

  it('returns a decimal-string estimate sourced only from the trip snapshot', async () => {
    executor.queueRows([
      {
        trip_id: '7',
        estimated_unit_price: '500.00',
        estimated_total: '1000.00',
        currency: 'MRU',
      },
    ]);

    const preview = await repository.findPublicPricePreview('7', 2);

    expect(preview).toEqual({
      tripId: '7',
      estimatedUnitPrice: '500.00',
      passengerCount: 2,
      estimatedTotal: '1000.00',
      currency: 'MRU',
      isEstimate: true,
    });
    expect(normalize(executor.calls[0].text)).toContain(
      'trip.price_mru::text AS estimated_unit_price',
    );
    expect(executor.calls[0].params).toEqual(['7', 2]);
  });

  it('returns null for a trip outside the public eligibility boundary', async () => {
    executor.queueRows([]);
    expect(await repository.findPublicAvailability('9')).toBeNull();

    executor.queueRows([]);
    expect(await repository.findPublicPricePreview('9', 1)).toBeNull();
  });
});
