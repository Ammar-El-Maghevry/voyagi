import { PaymentProviderUnavailableError } from './payment.errors';
import { PaymentsService } from './payments.service';
import { PaymentMethod } from './payment.types';
import type { PaymentsRepository } from './payments.repository';
import type {
  DatabaseService,
  TransactionManager,
} from '../../infrastructure/database';
import type { PaymentReferenceGenerator } from './payment-reference.generator';
import type { CommissionsService } from '../commissions/commissions.service';

/**
 * Provider-disabled safety (Phase 18.1): when NO payment provider is registered
 * (the production default), every payment mutation must fail safely with a
 * stable provider-unavailable error and must NOT touch the database, open a
 * transaction, create/settle a payment, confirm a booking, issue a ticket or
 * write a commission.
 */
describe('PaymentsService with payments disabled (no providers)', () => {
  // Any access to these throws, proving no state is read or mutated.
  const repository = new Proxy(
    {},
    {
      get() {
        throw new Error('repository must not be touched when disabled');
      },
    },
  ) as unknown as PaymentsRepository;

  const db = {} as DatabaseService;

  const transactions = {
    run: jest.fn(() => {
      throw new Error('a transaction must not be opened when disabled');
    }),
  } as unknown as TransactionManager;

  const references = {
    generate: jest.fn(() => {
      throw new Error('references must not be used when disabled');
    }),
  } as unknown as PaymentReferenceGenerator;

  const commissions = {} as CommissionsService;

  const audit = {
    append: jest.fn(() => {
      throw new Error('audit must not be written when disabled');
    }),
  };

  const service = new PaymentsService(
    repository,
    db,
    transactions,
    references,
    commissions,
    [], // no providers → payments disabled
    audit as never,
  );

  const uuid = '11111111-1111-4111-8111-111111111111';

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects passenger payment creation without opening a transaction', async () => {
    await expect(
      service.createPassengerPayment(uuid, 'idem-key-1', {
        bookingId: uuid,
        method: PaymentMethod.Bankily,
      }),
    ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    expect(transactions.run).not.toHaveBeenCalled();
  });

  it('rejects company payment creation without opening a transaction', async () => {
    await expect(
      service.createCompanyPayment(uuid, '1', 'idem-key-2', {
        bookingId: uuid,
        method: PaymentMethod.Bankily,
      }),
    ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    expect(transactions.run).not.toHaveBeenCalled();
  });

  it('rejects cash confirmation without opening a transaction', async () => {
    await expect(
      service.confirmCashPayment(uuid, '1', uuid),
    ).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    expect(transactions.run).not.toHaveBeenCalled();
  });

  it('rejects a refund without opening a transaction', async () => {
    await expect(service.refundPayment(uuid, '1', uuid)).rejects.toBeInstanceOf(
      PaymentProviderUnavailableError,
    );
    expect(transactions.run).not.toHaveBeenCalled();
  });

  it('rejects a webhook without opening a transaction or leaking config', async () => {
    let message = '';
    try {
      await service.handleWebhook('test', Buffer.from('{}'), {});
    } catch (error) {
      message = (error as Error).message;
      expect(error).toBeInstanceOf(PaymentProviderUnavailableError);
    }
    expect(transactions.run).not.toHaveBeenCalled();
    expect(message).toBe('Payment processing is currently unavailable.');
  });
});
