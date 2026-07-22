import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TripEventSource, TripEventType } from '../trip-event.types';
import type { TripEvent } from '../trip-event.types';

/** A trip event as returned by the events endpoint. */
export class TripEventResponseDto {
  @ApiProperty({ description: 'Event id.' })
  id!: string;

  @ApiProperty({ description: 'Trip id.' })
  tripId!: string;

  @ApiProperty({ enum: TripEventType, description: 'Event type.' })
  eventType!: TripEventType;

  @ApiProperty({ enum: TripEventSource, description: 'Event source.' })
  eventSource!: TripEventSource;

  @ApiPropertyOptional({ description: 'Acting user id, when known.' })
  actorUserId?: string;

  @ApiProperty({ format: 'date-time' })
  eventTime!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  static from(event: TripEvent): TripEventResponseDto {
    return {
      id: event.id,
      tripId: event.tripId,
      eventType: event.eventType,
      eventSource: event.eventSource,
      actorUserId: event.actorUserId,
      eventTime: event.eventTime.toISOString(),
      createdAt: event.createdAt.toISOString(),
    };
  }
}
