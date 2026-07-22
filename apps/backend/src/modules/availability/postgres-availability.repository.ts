import { Inject, Injectable } from '@nestjs/common';
import type { ResolvedPagination } from '../../common/pagination/pagination';
import { DatabaseService } from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import type {
  AvailabilityRepository,
  PagedResult,
  PublicTripSearchFilter,
} from './availability.repository';
import {
  OccupantGender,
  SeatAvailabilityStatus,
  type PublicSeatAvailability,
  type PublicTripAvailability,
  type PublicTripPricePreview,
  type PublicTripSearchItem,
} from './availability.types';

interface SearchRow {
  trip_id: string;
  company_id: string;
  company_name: string;
  company_logo_url: string | null;
  origin_station_id: string;
  origin_name_ar: string;
  origin_name_fr: string;
  destination_station_id: string;
  destination_name_ar: string;
  destination_name_fr: string;
  departure_time: Date;
  estimated_arrival_time: Date;
  estimated_price: string;
  currency: string;
  available_seat_count: number;
}

interface AvailabilityRow {
  trip_id: string;
  total_seat_count: number;
  seat_id: string;
  label: string;
  status: SeatAvailabilityStatus;
  occupant_gender: OccupantGender | null;
}

interface PriceRow {
  trip_id: string;
  estimated_unit_price: string;
  estimated_total: string;
  currency: string;
}

const PUBLIC_TRIP_JOINS = `
  JOIN public.companies company ON company.id = trip.company_id
  JOIN public.routes route ON route.id = trip.route_id AND route.company_id = trip.company_id
  JOIN public.stations origin ON origin.id = route.origin_station_id
  JOIN public.stations destination ON destination.id = route.destination_station_id
  JOIN public.buses bus ON bus.id = trip.bus_id AND bus.company_id = trip.company_id
  JOIN public.seat_layouts layout ON layout.id = bus.seat_layout_id`;

const PUBLIC_TRIP_FILTER = `
  trip.is_active
  AND trip.status = 'SCHEDULED'::public.trip_status_enum
  AND now() < trip.boarding_closes_at
  AND company.is_active AND company.archived_at IS NULL
  AND route.is_active AND route.deleted_at IS NULL
  AND origin.is_active AND origin.deleted_at IS NULL
  AND destination.is_active AND destination.deleted_at IS NULL
  AND bus.is_active AND bus.deleted_at IS NULL
  AND bus.status = 'ACTIVE'::public.bus_status_enum`;

/** PostgreSQL adapter exposing only the approved public trip projection. */
@Injectable()
export class PostgresAvailabilityRepository implements AvailabilityRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseExecutor,
  ) {}

  async searchPublicTrips(
    filter: PublicTripSearchFilter,
    pagination: ResolvedPagination,
  ): Promise<PagedResult<PublicTripSearchItem>> {
    const params = [
      filter.originStationId,
      filter.destinationStationId,
      filter.departureFrom,
      filter.departureBefore,
    ] as const;
    const result = await this.database.query<SearchRow>(
      `SELECT trip.id AS trip_id,
              company.id AS company_id,
              company.name AS company_name,
              company.logo_url AS company_logo_url,
              origin.id AS origin_station_id,
              origin.name_ar AS origin_name_ar,
              origin.name_fr AS origin_name_fr,
              destination.id AS destination_station_id,
              destination.name_ar AS destination_name_ar,
              destination.name_fr AS destination_name_fr,
              trip.departure_time,
              trip.estimated_arrival_time,
              trip.price_mru AS estimated_price,
              trip.currency,
              GREATEST(0, layout.total_seats - (
                SELECT count(reservation.id)::integer
                FROM public.seat_reservations reservation
                WHERE reservation.trip_id = trip.id
                  AND (
                    reservation.status IN ('CONFIRMED', 'CHECKED_IN')
                    OR (reservation.status = 'HELD' AND reservation.held_until > now())
                  )
              ))::integer AS available_seat_count
         FROM public.trips trip
         ${PUBLIC_TRIP_JOINS}
         WHERE ${PUBLIC_TRIP_FILTER}
           AND route.origin_station_id = $1
           AND route.destination_station_id = $2
           AND trip.departure_time >= $3
           AND trip.departure_time < $4
         ORDER BY trip.departure_time, trip.id
         LIMIT $5 OFFSET $6`,
      [...params, pagination.limit, pagination.offset],
      { name: 'availability.search_public_trips' },
    );
    const count = await this.database.query<{ total: string }>(
      `SELECT count(trip.id)::text AS total
         FROM public.trips trip
         ${PUBLIC_TRIP_JOINS}
         WHERE ${PUBLIC_TRIP_FILTER}
           AND route.origin_station_id = $1
           AND route.destination_station_id = $2
           AND trip.departure_time >= $3
           AND trip.departure_time < $4`,
      params,
      { name: 'availability.count_public_trips' },
    );
    return {
      items: result.rows.map((row) => this.toSearchItem(row)),
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  async findPublicAvailability(
    tripId: string,
  ): Promise<PublicTripAvailability | null> {
    const result = await this.database.query<AvailabilityRow>(
      `SELECT trip.id AS trip_id,
              layout.total_seats AS total_seat_count,
              seat.label AS seat_id,
              seat.label,
              CASE
                WHEN reservation.status = 'HELD' THEN 'HELD'
                WHEN reservation.status IN ('CONFIRMED', 'CHECKED_IN') THEN 'BOOKED'
                ELSE 'AVAILABLE'
              END AS status,
               passenger.gender::text AS occupant_gender
         FROM public.trips trip
         ${PUBLIC_TRIP_JOINS}
         CROSS JOIN LATERAL jsonb_array_elements_text(
           CASE
             WHEN jsonb_typeof(layout.layout_grid) = 'object'
               THEN layout.layout_grid -> 'seat_numbers'
             ELSE layout.layout_grid
           END
         ) WITH ORDINALITY AS seat(label, position)
         LEFT JOIN public.seat_reservations reservation
           ON reservation.trip_id = trip.id
          AND reservation.seat_number = seat.label
          AND (
            reservation.status IN ('CONFIRMED', 'CHECKED_IN')
             OR (reservation.status = 'HELD' AND reservation.held_until > now())
           )
         LEFT JOIN public.passengers passenger
           ON passenger.id = reservation.passenger_id
          AND passenger.booking_id = reservation.booking_id
         WHERE trip.id = $1 AND ${PUBLIC_TRIP_FILTER}
         ORDER BY seat.position`,
      [tripId],
      { name: 'availability.find_public_seats' },
    );
    if (result.rows.length === 0) {
      return null;
    }
    const seats = result.rows.map((row): PublicSeatAvailability => ({
      seatId: row.seat_id,
      label: row.label,
      status: row.status,
      occupantGender: row.occupant_gender,
    }));
    return {
      tripId: result.rows[0].trip_id,
      totalSeatCount: result.rows[0].total_seat_count,
      availableSeatCount: seats.filter(
        (seat) => seat.status === SeatAvailabilityStatus.Available,
      ).length,
      seats,
    };
  }

  async findPublicPricePreview(
    tripId: string,
    passengerCount: number,
  ): Promise<PublicTripPricePreview | null> {
    const result = await this.database.query<PriceRow>(
      `SELECT trip.id AS trip_id,
               trip.price_mru::text AS estimated_unit_price,
               (trip.price_mru * $2::integer)::text AS estimated_total,
              trip.currency
         FROM public.trips trip
         ${PUBLIC_TRIP_JOINS}
         WHERE trip.id = $1 AND ${PUBLIC_TRIP_FILTER}`,
      [tripId, passengerCount],
      { name: 'availability.find_public_price_preview' },
    );
    const row = result.rows[0];
    return row
      ? {
          tripId: row.trip_id,
          estimatedUnitPrice: row.estimated_unit_price,
          passengerCount,
          estimatedTotal: row.estimated_total,
          currency: row.currency,
          isEstimate: true,
        }
      : null;
  }

  private toSearchItem(row: SearchRow): PublicTripSearchItem {
    return {
      tripId: row.trip_id,
      company: {
        id: row.company_id,
        name: row.company_name,
        logoUrl: row.company_logo_url,
      },
      originStation: {
        id: row.origin_station_id,
        nameAr: row.origin_name_ar,
        nameFr: row.origin_name_fr,
      },
      destinationStation: {
        id: row.destination_station_id,
        nameAr: row.destination_name_ar,
        nameFr: row.destination_name_fr,
      },
      departureTime: row.departure_time,
      estimatedArrivalTime: row.estimated_arrival_time,
      estimatedPrice: row.estimated_price,
      currency: row.currency,
      availableSeatCount: row.available_seat_count,
    };
  }
}
