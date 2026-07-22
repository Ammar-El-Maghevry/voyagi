import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import {
  CancelBookingUseCase,
  CreateAgentBookingUseCase,
  CreatePassengerBookingUseCase,
  ExpireBookingUseCase,
  GetBookingUseCase,
  ListBookingEventsUseCase,
  ListBookingsUseCase,
} from '../../src/modules/bookings/booking.use-cases';
import { BookingsModule } from '../../src/modules/bookings/bookings.module';
import {
  CompanyBookingsController,
  PassengerBookingsController,
} from '../../src/modules/bookings/bookings.controller';
import { BOOKINGS_REPOSITORY } from '../../src/modules/bookings/bookings.repository';
import { BookingsService } from '../../src/modules/bookings/bookings.service';
import { PostgresBookingsRepository } from '../../src/modules/bookings/postgres-bookings.repository';

describe('Bookings module wiring (integration)', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
  });

  it('wires only booking providers to the real AppModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const opts = { strict: false } as const;

    expect(moduleRef.get(PassengerBookingsController, opts)).toBeInstanceOf(
      PassengerBookingsController,
    );
    expect(moduleRef.get(CompanyBookingsController, opts)).toBeInstanceOf(
      CompanyBookingsController,
    );
    expect(moduleRef.get(BookingsService, opts)).toBeInstanceOf(
      BookingsService,
    );
    for (const useCase of [
      CreatePassengerBookingUseCase,
      CreateAgentBookingUseCase,
      GetBookingUseCase,
      ListBookingsUseCase,
      CancelBookingUseCase,
      ExpireBookingUseCase,
      ListBookingEventsUseCase,
    ]) {
      expect(moduleRef.get(useCase, opts)).toBeInstanceOf(useCase);
    }
    expect(moduleRef.get(BOOKINGS_REPOSITORY, opts)).toBeInstanceOf(
      PostgresBookingsRepository,
    );

    const providers = (Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      BookingsModule,
    ) ?? []) as unknown[] | undefined;
    const providerNames = (providers ?? []).flatMap((provider) => {
      if (typeof provider === 'function') return [provider.name];
      const definition = provider as { provide?: unknown; useClass?: unknown };
      const token =
        typeof definition.provide === 'symbol'
          ? definition.provide.description
          : '';
      const className =
        typeof definition.useClass === 'function'
          ? definition.useClass.name
          : '';
      return [token ?? '', className];
    });
    expect(providerNames.join(' ')).not.toMatch(/payment|ticket/i);

    await moduleRef.close();
  });
});
