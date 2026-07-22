import type {
  DatabaseService,
  TransactionManager,
} from '../../infrastructure/database';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { resolvePagination } from '../../common/pagination/pagination';
import { MembershipRole } from '../identity/membership-role';
import { InMemoryBookingsRepository } from '../../../test/support/in-memory-bookings.repository';
import {
  BookingBranchForbiddenError,
  BookingNotCancellableError,
  BookingNotFoundError,
  BookingReferenceUnavailableError,
  IdempotencyConflictError,
  TripNotBookableError,
} from './booking.errors';
import type { BookingReferenceGenerator } from './booking-reference.generator';
import {
  BookingStatus,
  PassengerGender,
  type CreateBookingInput,
} from './booking.types';
import { BookingsService } from './bookings.service';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';

const transactions = {
  run: <T>(work: (tx: DatabaseExecutor) => Promise<T>): Promise<T> =>
    work({} as DatabaseExecutor),
} as unknown as TransactionManager;

const input = (seatId = '1A'): CreateBookingInput => ({
  tripId: '100',
  passengers: [
    { fullName: 'Test Passenger', gender: PassengerGender.Unspecified, seatId },
  ],
});

describe('BookingsService', () => {
  let repository: InMemoryBookingsRepository;
  let service: BookingsService;

  beforeEach(() => {
    repository = new InMemoryBookingsRepository();
    repository.addTrip();
    service = new BookingsService(
      repository,
      {} as DatabaseService,
      transactions,
    );
  });

  it('replays an identical passenger request and rejects a changed payload for the same key', async () => {
    const first = await service.createPassengerBooking(
      OWNER,
      'same-key',
      input(),
    );
    const replay = await service.createPassengerBooking(
      OWNER,
      'same-key',
      input(),
    );

    expect(replay.id).toBe(first.id);
    expect(repository.bookingCount).toBe(1);
    await expect(
      service.createPassengerBooking(OWNER, 'same-key', input('1B')),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(repository.bookingCount).toBe(1);
  });

  it('treats reordered object fields as the same idempotent payload', async () => {
    const first = await service.createPassengerBooking(
      OWNER,
      'canonical-key',
      input(),
    );
    const reordered = {
      passengers: [
        {
          seatId: '1A',
          gender: PassengerGender.Unspecified,
          fullName: 'Test Passenger',
        },
      ],
      tripId: '100',
    };

    await expect(
      service.createPassengerBooking(OWNER, 'canonical-key', reordered),
    ).resolves.toMatchObject({ id: first.id });
    expect(repository.bookingCount).toBe(1);
  });

  it('scopes idempotency by actor so another passenger can use the same key', async () => {
    const first = await service.createPassengerBooking(
      OWNER,
      'shared-key',
      input('1A'),
    );
    const second = await service.createPassengerBooking(
      OTHER,
      'shared-key',
      input('1B'),
    );

    expect(second.id).not.toBe(first.id);
    expect(repository.bookingCount).toBe(2);
  });

  it('retries only booking-reference collisions and succeeds with the next reference', async () => {
    repository.addBooking({ bookingReference: 'VYG-20260722-AAAAAA' });
    const references = {
      generate: jest
        .fn()
        .mockReturnValueOnce('VYG-20260722-AAAAAA')
        .mockReturnValueOnce('VYG-20260722-BBBBBB'),
    } as unknown as BookingReferenceGenerator;
    service = new BookingsService(
      repository,
      {} as DatabaseService,
      transactions,
      references,
    );

    await expect(
      service.createPassengerBooking(OTHER, 'reference-retry', input('1B')),
    ).resolves.toMatchObject({ bookingReference: 'VYG-20260722-BBBBBB' });
    expect(references.generate).toHaveBeenCalledTimes(2);
  });

  it('returns a dedicated error after bounded reference collision retries', async () => {
    repository.addBooking({ bookingReference: 'VYG-20260722-AAAAAA' });
    const references = {
      generate: jest.fn().mockReturnValue('VYG-20260722-AAAAAA'),
    } as unknown as BookingReferenceGenerator;
    service = new BookingsService(
      repository,
      {} as DatabaseService,
      transactions,
      references,
    );

    await expect(
      service.createPassengerBooking(OTHER, 'reference-exhausted', input('1B')),
    ).rejects.toBeInstanceOf(BookingReferenceUnavailableError);
    expect(references.generate).toHaveBeenCalledTimes(3);
  });

  it('rejects an out-of-range boarding station before querying PostgreSQL', async () => {
    await expect(
      service.createPassengerBooking(OWNER, 'bad-station', {
        tripId: '100',
        passengers: [
          {
            fullName: 'Test Passenger',
            gender: PassengerGender.Unspecified,
            seatId: '1A',
            boardingStationId: '9223372036854775808',
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(repository.bookingCount).toBe(0);
  });

  it('hides owned bookings from other users', async () => {
    const booking = await service.createPassengerBooking(
      OWNER,
      'owned-key',
      input(),
    );

    await expect(
      service.getOwnedBooking(OTHER, booking.id),
    ).rejects.toBeInstanceOf(BookingNotFoundError);
    await expect(
      service.listOwnedEvents(OTHER, booking.id, resolvePagination()),
    ).rejects.toBeInstanceOf(BookingNotFoundError);
  });

  it('keeps company reads within the permission-bearing membership branch', async () => {
    repository.addMembership({
      userId: AGENT,
      companyId: '10',
      branchId: '1',
      role: MembershipRole.BranchEmployee,
    });
    const visible = repository.addBooking({
      branchId: '1',
      bookedByUserId: OWNER,
    });
    const hidden = repository.addBooking({
      branchId: '2',
      bookedByUserId: OWNER,
    });

    await expect(
      service.getCompanyBooking(AGENT, '10', visible.id),
    ).resolves.toMatchObject({
      id: visible.id,
    });
    await expect(
      service.getCompanyBooking(AGENT, '10', hidden.id),
    ).rejects.toBeInstanceOf(BookingNotFoundError);
  });

  it('does not cross-product create permission in Branch A with read access in Branch B', async () => {
    repository.addMembership({
      userId: AGENT,
      companyId: '10',
      branchId: '1',
      role: MembershipRole.Agent,
    });
    repository.addMembership({
      userId: AGENT,
      companyId: '10',
      branchId: '2',
      role: MembershipRole.BranchEmployee,
    });

    await expect(
      service.createAgentBooking(AGENT, '10', '2', 'agent-key', input()),
    ).rejects.toBeInstanceOf(BookingBranchForbiddenError);
    expect(repository.bookingCount).toBe(0);

    await expect(
      service.createAgentBooking(AGENT, '10', '1', 'agent-key', input()),
    ).resolves.toMatchObject({ branchId: '1' });
  });

  it('does not treat a branch agent as the passenger owner of an agent booking', async () => {
    repository.addMembership({
      userId: AGENT,
      companyId: '10',
      branchId: '1',
      role: MembershipRole.Agent,
    });
    const booking = await service.createAgentBooking(
      AGENT,
      '10',
      '1',
      'agent-owned-key',
      input(),
    );

    await expect(service.getOwnedBooking(AGENT, booking.id)).rejects.toBeInstanceOf(
      BookingNotFoundError,
    );
    await expect(
      service.cancelOwnedBooking(AGENT, booking.id),
    ).rejects.toBeInstanceOf(BookingNotFoundError);
  });

  it('cancels a held booking once and records the terminal state', async () => {
    const booking = await service.createPassengerBooking(
      OWNER,
      'cancel-key',
      input(),
    );
    const cancelled = await service.cancelOwnedBooking(OWNER, booking.id);

    expect(cancelled).toMatchObject({
      status: BookingStatus.Cancelled,
      version: 2,
    });
    expect(
      (await service.listOwnedEvents(OWNER, booking.id, resolvePagination())).items.map(
        (event) => event.eventType,
      ),
    ).toEqual(['CANCELLED', 'BOOKING_CREATED']);
    await expect(
      service.cancelOwnedBooking(OWNER, booking.id),
    ).rejects.toBeInstanceOf(BookingNotCancellableError);
  });

  it.each([
    { status: 'CANCELLED', isActive: true },
    { status: 'SCHEDULED', isActive: false },
  ])('rejects a trip outside the bookable state: %o', async (trip) => {
    repository.addTrip(trip);
    await expect(
      service.createPassengerBooking(
        OWNER,
        `state-${trip.status}-${trip.isActive}`,
        input(),
      ),
    ).rejects.toBeInstanceOf(TripNotBookableError);
  });

  it('expires stale holds and makes their seats available to a new booking', async () => {
    const expired = repository.addBooking({
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      passengers: [
        {
          id: '1',
          fullName: 'Expired Passenger',
          gender: PassengerGender.Unspecified,
          seatId: '1A',
        },
      ],
    });

    const created = await service.createPassengerBooking(
      OTHER,
      'after-expiry',
      input('1A'),
    );

    expect(created.passengers[0].seatId).toBe('1A');
    expect((await service.getOwnedBooking(OWNER, expired.id)).status).toBe(
      BookingStatus.Expired,
    );
    expect(
      (await service.listOwnedEvents(OWNER, expired.id, resolvePagination())).items[0]
        .eventType,
    ).toBe('EXPIRED');
  });
});
