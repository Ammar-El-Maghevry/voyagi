import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { resolvePagination } from '../../common/pagination/pagination';
import { PostgresStaffRepository } from './postgres-staff.repository';
import type { StaffMemberRow } from './staff.mapper';
import { StaffType } from './staff-type';

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

const row: StaffMemberRow = {
  id: '7',
  company_id: '10',
  full_name: 'Sidi Driver',
  phone: null,
  staff_type: 'DRIVER',
  is_active: true,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

describe('PostgresStaffRepository (SQL scoping)', () => {
  let executor: FakeExecutor;
  let repository: PostgresStaffRepository;

  beforeEach(() => {
    executor = new FakeExecutor();
    repository = new PostgresStaffRepository(executor);
  });

  const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();

  it('scopes list by company_id and excludes soft-deleted rows', async () => {
    executor.queueRows([row]);
    executor.queueRows([{ total: '1' }]);
    await repository.listByCompany('10', resolvePagination());

    const list = norm(executor.calls[0].text);
    expect(list).toContain('FROM public.staff_members');
    expect(list).toContain('company_id = $1');
    expect(list).toContain('deleted_at IS NULL');
  });

  it('scopes a single read by id AND company_id AND deleted_at', async () => {
    executor.queueRows([row]);
    await repository.findInCompany('10', '7');
    expect(norm(executor.calls[0].text)).toContain(
      'WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL',
    );
    expect(executor.calls[0].params).toEqual(['7', '10']);
  });

  it('inserts with the tenant company id and enum staff_type', async () => {
    executor.queueRows([row]);
    const created = await repository.create('10', {
      fullName: 'Sidi Driver',
      staffType: StaffType.Driver,
    });
    expect(norm(executor.calls[0].text)).toContain('INSERT INTO public.staff_members');
    expect(executor.calls[0].params).toEqual(['10', 'Sidi Driver', null, 'DRIVER']);
    expect(created.staffType).toBe(StaffType.Driver);
  });

  it('transitions activation atomically with the opposite-state precondition', async () => {
    executor.queueRows([row]);
    await repository.transitionActive('10', '7', true);
    const sql = norm(executor.calls[0].text);
    expect(sql).toContain('UPDATE public.staff_members');
    expect(sql).toContain('is_active = NOT $3');
    expect(executor.calls[0].params).toEqual(['7', '10', true]);
  });
});
