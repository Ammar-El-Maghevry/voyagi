import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { PostgresAuditRepository } from './postgres-audit.repository';

const UUID = '8a5e3649-17c2-4b0c-b858-7293f05458d2';

const row = {
  id: '1',
  actor_user_id: null,
  company_id: '10',
  action: 'booking.confirmed',
  entity_type: 'booking',
  entity_id: 'booking-1',
  old_values: { status: 'PENDING' },
  new_values: { status: 'CONFIRMED' },
  request_id: null,
  correlation_id: UUID,
  created_at: new Date('2026-07-22T00:00:00.000Z'),
};

describe('PostgresAuditRepository', () => {
  it('stores invalid request ids as NULL while retaining valid UUID correlation ids', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [row] });
    const repository = new PostgresAuditRepository();

    await repository.append({ query } as unknown as DatabaseExecutor, {
      companyId: '10',
      action: 'booking.confirmed',
      entityType: 'booking',
      entityId: 'booking-1',
      oldValues: { status: 'PENDING' },
      newValues: { status: 'CONFIRMED' },
      requestId: 'client-request-id',
      correlationId: UUID,
    });

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[7]).toBeNull();
    expect(params[8]).toBe(UUID);
  });

  it('scopes list and count queries explicitly by company before pagination', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] });
    const repository = new PostgresAuditRepository();

    const page = await repository.listByCompany(
      { query } as unknown as DatabaseExecutor,
      '10',
      { page: 2, pageSize: 20, limit: 20, offset: 20 },
    );

    expect(query.mock.calls[0][0]).toContain('WHERE company_id = $1');
    expect(query.mock.calls[0][1]).toEqual(['10', 20, 20]);
    expect(query.mock.calls[1][0]).toContain('WHERE company_id = $1');
    expect(page.total).toBe(1);
  });
});
