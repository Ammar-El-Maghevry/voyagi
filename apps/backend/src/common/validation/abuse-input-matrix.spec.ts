import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { ValidationException } from './validation.exception';
import { validationPipeOptions } from './validation-pipe.options';
import {
  MALFORMED_IDS,
  MALFORMED_PRIMITIVES,
  MALFORMED_UUIDS,
  PRIVILEGED_FIELDS,
  SQL_INJECTION_STRINGS,
  withPrivilegedField,
} from '../../../test/support/factories/abuse-cases';
import {
  CreateBookingDto,
  CreateAgentBookingDto,
} from '../../modules/bookings/dto/create-booking.dto';
import { CreatePaymentDto } from '../../modules/payments/dto/create-payment.dto';
import { CreateBranchDto } from '../../modules/branches/dto/create-branch.dto';
import { CreateBusDto } from '../../modules/buses/dto/create-bus.dto';
import { CreateRouteDto } from '../../modules/routes/dto/create-route.dto';
import { CreateRoutePriceDto } from '../../modules/routes/dto/create-route-price.dto';
import { CreateTripDto } from '../../modules/trips/dto/create-trip.dto';
import { CreateStaffMemberDto } from '../../modules/staff/dto/create-staff-member.dto';
import { CreateMaintenanceRecordDto } from '../../modules/maintenance/dto/create-maintenance-record.dto';
import { VerifyTicketDto } from '../../modules/tickets/dto/verify-ticket.dto';
import { UpdateProfileDto } from '../../modules/identity/dto/update-profile.dto';

/**
 * Mass-assignment and malformed-input matrix exercised through the REAL global
 * validation policy (`validationPipeOptions`: whitelist + forbidNonWhitelisted +
 * transform). Because guards/pipes reject the request before any use-case or
 * repository runs, proving rejection here proves that no privileged value ever
 * reaches PostgreSQL and no state mutation occurs.
 *
 * Server-authoritative fields (id/company/branch/owner/status/amount/currency/
 * references/qr/audit/timestamps/permissions/roles/commission…) are declared on
 * NO write DTO, so each is rejected as an unknown property.
 */

const pipe = new ValidationPipe(validationPipeOptions);

function meta(metatype: unknown): ArgumentMetadata {
  return { type: 'body', metatype: metatype as never, data: '' };
}

async function expectRejected(
  metatype: unknown,
  payload: Record<string, unknown>,
): Promise<void> {
  await expect(pipe.transform(payload, meta(metatype))).rejects.toBeInstanceOf(
    ValidationException,
  );
}

async function expectAccepted(
  metatype: unknown,
  payload: Record<string, unknown>,
): Promise<void> {
  await expect(pipe.transform(payload, meta(metatype))).resolves.toBeInstanceOf(
    metatype as never,
  );
}

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const LATER = new Date(Date.now() + 90_000_000).toISOString();
const VALID_UUID = '11111111-1111-4111-8111-111111111111';

/** Each write DTO with a valid baseline plus its typed field shape. */
interface DtoTarget {
  label: string;
  dto: unknown;
  base: Record<string, unknown>;
  idFields: string[];
  uuidFields: string[];
  enumFields: string[];
}

const TARGETS: DtoTarget[] = [
  {
    label: 'CreateBookingDto',
    dto: CreateBookingDto,
    base: { tripId: '1', passengers: [{ fullName: 'Traveller', seatId: '1' }] },
    idFields: ['tripId'],
    uuidFields: [],
    enumFields: [],
  },
  {
    label: 'CreateAgentBookingDto',
    dto: CreateAgentBookingDto,
    base: {
      tripId: '1',
      branchId: '1',
      passengers: [{ fullName: 'Traveller', seatId: '1' }],
    },
    idFields: ['tripId', 'branchId'],
    uuidFields: [],
    enumFields: [],
  },
  {
    label: 'CreatePaymentDto',
    dto: CreatePaymentDto,
    base: { bookingId: VALID_UUID, method: 'BANKILY' },
    idFields: [],
    uuidFields: ['bookingId'],
    enumFields: ['method'],
  },
  {
    label: 'CreateBranchDto',
    dto: CreateBranchDto,
    base: { cityId: '1', nameAr: 'اسم', nameFr: 'Nom' },
    idFields: ['cityId'],
    uuidFields: [],
    enumFields: [],
  },
  {
    label: 'CreateBusDto',
    dto: CreateBusDto,
    base: { seatLayoutId: '1', plateNumber: 'ABC-123' },
    idFields: ['seatLayoutId'],
    uuidFields: [],
    enumFields: [],
  },
  {
    label: 'CreateRouteDto',
    dto: CreateRouteDto,
    base: {
      originStationId: '1',
      destinationStationId: '2',
      defaultPriceMru: 100,
      estimatedDurationMinutes: 60,
    },
    idFields: ['originStationId', 'destinationStationId'],
    uuidFields: [],
    enumFields: [],
  },
  {
    label: 'CreateRoutePriceDto',
    dto: CreateRoutePriceDto,
    base: { priceMru: 100 },
    idFields: [],
    uuidFields: [],
    enumFields: [],
  },
  {
    label: 'CreateTripDto',
    dto: CreateTripDto,
    base: {
      routeId: '1',
      busId: '2',
      departureTime: FUTURE,
      estimatedArrivalTime: LATER,
    },
    idFields: ['routeId', 'busId'],
    uuidFields: [],
    enumFields: [],
  },
  {
    label: 'CreateStaffMemberDto',
    dto: CreateStaffMemberDto,
    base: { fullName: 'Driver One', staffType: 'DRIVER' },
    idFields: [],
    uuidFields: [],
    enumFields: ['staffType'],
  },
  {
    label: 'CreateMaintenanceRecordDto',
    dto: CreateMaintenanceRecordDto,
    base: {
      busId: '1',
      maintenanceType: 'OIL_CHANGE',
      startedAt: FUTURE,
      scheduledEndsAt: LATER,
    },
    idFields: ['busId'],
    uuidFields: [],
    enumFields: ['maintenanceType'],
  },
  {
    label: 'VerifyTicketDto',
    dto: VerifyTicketDto,
    base: { qrToken: 'A'.repeat(24) },
    idFields: [],
    uuidFields: [],
    enumFields: [],
  },
  {
    label: 'UpdateProfileDto',
    dto: UpdateProfileDto,
    base: { fullName: 'New Name' },
    idFields: [],
    uuidFields: [],
    enumFields: [],
  },
];

describe('abuse & malformed-input matrix (global validation policy)', () => {
  describe('every write DTO accepts its valid baseline', () => {
    it.each(TARGETS)(
      '$label accepts a valid payload',
      async ({ dto, base }) => {
        await expectAccepted(dto, base);
      },
    );
  });

  describe('mass-assignment: privileged fields are rejected as unknown properties', () => {
    for (const target of TARGETS) {
      it.each(PRIVILEGED_FIELDS)(
        `${target.label} rejects injected "%s"`,
        async (field) => {
          // Skip a field that is a legitimate part of this DTO's baseline.
          if (Object.prototype.hasOwnProperty.call(target.base, field)) return;
          await expectRejected(
            target.dto,
            withPrivilegedField(target.base, field),
          );
        },
      );
    }
  });

  // A 40-digit string is a VALID positive-integer shape at the DTO layer; its
  // magnitude is rejected downstream by the PostgreSQL `bigint` range, proven in
  // the SQL-injection integration matrix. The DTO layer enforces shape only.
  const shapeInvalidIds = MALFORMED_IDS.filter(
    (c) => c.label !== 'huge-integer-string',
  );

  describe('malformed (shape-invalid) identifiers are rejected', () => {
    for (const target of TARGETS.filter((t) => t.idFields.length > 0)) {
      it.each(shapeInvalidIds)(
        `${target.label} rejects a ${'$label'} id`,
        async ({ value }) => {
          for (const field of target.idFields) {
            await expectRejected(target.dto, {
              ...target.base,
              [field]: value,
            });
          }
        },
      );
    }

    it('a shape-valid but out-of-range id passes DTO shape validation (DB enforces range)', async () => {
      await expectAccepted(CreateBranchDto, {
        cityId: '9'.repeat(40),
        nameAr: 'اسم',
        nameFr: 'Nom',
      });
    });
  });

  describe('malformed UUIDs are rejected', () => {
    for (const target of TARGETS.filter((t) => t.uuidFields.length > 0)) {
      it.each(MALFORMED_UUIDS)(
        `${target.label} rejects a ${'$label'} uuid`,
        async ({ value }) => {
          for (const field of target.uuidFields) {
            await expectRejected(target.dto, {
              ...target.base,
              [field]: value,
            });
          }
        },
      );
    }
  });

  describe('malformed enum values are rejected', () => {
    for (const target of TARGETS.filter((t) => t.enumFields.length > 0)) {
      it(`${target.label} rejects an invalid enum`, async () => {
        for (const field of target.enumFields) {
          await expectRejected(target.dto, {
            ...target.base,
            [field]: 'NOT_A_VALID_ENUM',
          });
        }
      });
    }
  });

  describe('malformed primitives on numeric/date fields are rejected', () => {
    it('CreateRouteDto rejects malformed price/duration values', async () => {
      for (const { value } of MALFORMED_PRIMITIVES) {
        await expectRejected(CreateRouteDto, {
          originStationId: '1',
          destinationStationId: '2',
          defaultPriceMru: value,
          estimatedDurationMinutes: 60,
        });
      }
    });

    it('CreateTripDto rejects malformed departure timestamps', async () => {
      const malformedDates = ['not-a-date', '2026-13-40', '', 'Infinity', '{}'];
      for (const value of malformedDates) {
        await expectRejected(CreateTripDto, {
          routeId: '1',
          busId: '2',
          departureTime: value,
          estimatedArrivalTime: LATER,
        });
      }
    });
  });

  describe('SQL-injection strings in identifier/token fields are rejected as data', () => {
    it('id, uuid and token fields reject injection payloads (never reach a repository)', async () => {
      for (const { value } of SQL_INJECTION_STRINGS) {
        await expectRejected(CreateBookingDto, {
          tripId: value,
          passengers: [{ fullName: 'Traveller', seatId: '1' }],
        });
        await expectRejected(CreatePaymentDto, {
          bookingId: value,
          method: 'BANKILY',
        });
        await expectRejected(VerifyTicketDto, { qrToken: value });
      }
    });
  });

  describe('nested passenger arrays are validated and bounded', () => {
    it('rejects an oversized passenger array (ArrayMaxSize)', async () => {
      const passengers = Array.from({ length: 25 }, (_, i) => ({
        fullName: `P${i}`,
        seatId: String(i + 1),
      }));
      await expectRejected(CreateBookingDto, { tripId: '1', passengers });
    });

    it('rejects a privileged field injected into a nested passenger', async () => {
      await expectRejected(CreateBookingDto, {
        tripId: '1',
        passengers: [{ fullName: 'P', seatId: '1', companyId: '9', id: '1' }],
      });
    });

    it('rejects an empty passenger array (ArrayMinSize)', async () => {
      await expectRejected(CreateBookingDto, { tripId: '1', passengers: [] });
    });
  });
});
