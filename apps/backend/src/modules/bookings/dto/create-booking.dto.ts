import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  type BookingPassengerInput,
  type CreateBookingInput,
  PassengerGender,
} from '../booking.types';

const POSITIVE_ID = /^[1-9][0-9]*$/;
const PHONE = /^\+?[0-9]{8,20}$/;

export class BookingPassengerDto implements BookingPassengerInput {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  fullName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(PHONE)
  phone?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/\S/)
  documentNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(POSITIVE_ID)
  boardingStationId?: string;

  @ApiPropertyOptional({ enum: PassengerGender, default: PassengerGender.Unspecified })
  @IsOptional()
  @IsEnum(PassengerGender)
  gender?: PassengerGender;

  @ApiProperty({ description: 'Canonical seat label from the seat map.' })
  @IsString()
  @MaxLength(20)
  @Matches(/^\S(?:.*\S)?$/)
  seatId!: string;
}

export class CreateBookingDto implements CreateBookingInput {
  @ApiProperty()
  @Matches(POSITIVE_ID)
  tripId!: string;

  @ApiProperty({ type: BookingPassengerDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BookingPassengerDto)
  passengers!: BookingPassengerDto[];

  toDomain(): CreateBookingInput {
    return {
      tripId: this.tripId,
      passengers: this.passengers.map((passenger) => ({
        ...passenger,
        gender: passenger.gender ?? PassengerGender.Unspecified,
      })),
    };
  }
}

export class CreateAgentBookingDto extends CreateBookingDto {
  @ApiProperty({ description: 'Branch where the agent performs the booking.' })
  @Matches(POSITIVE_ID)
  branchId!: string;
}
