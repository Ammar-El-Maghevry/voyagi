import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { resolvePagination } from '../../common/pagination/pagination';
import type { BranchRow } from './branch.mapper';
import { PostgresBranchesRepository } from './postgres-branches.repository';

/** A recording fake executor that returns queued result rows in order. */
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

const row: BranchRow = {
  id: '100',
  company_id: '10',
  city_id: '5',
  name_ar: 'فرع',
  name_fr: 'Agence',
  phone: null,
  is_active: true,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

describe('PostgresBranchesRepository (SQL scoping)', () => {
  let executor: FakeExecutor;
  let repository: PostgresBranchesRepository;

  beforeEach(() => {
    executor = new FakeExecutor();
    repository = new PostgresBranchesRepository(executor);
  });

  const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();

  it('scopes list by company_id and excludes soft-deleted rows', async () => {
    executor.queueRows([row]); // page
    executor.queueRows([{ total: '1' }]); // count
    await repository.listByCompany('10', resolvePagination());

    const list = norm(executor.calls[0].text);
    expect(list).toContain('FROM public.branches');
    expect(list).toContain('company_id = $1');
    expect(list).toContain('deleted_at IS NULL');
    expect(executor.calls[0].params[0]).toBe('10');
  });

  it('restricts a scoped list to the given branch ids with a bigint array', async () => {
    executor.queueRows([row]);
    executor.queueRows([{ total: '1' }]);
    await repository.listByCompanyAndBranchIds('10', ['100', '200'], resolvePagination());

    const list = norm(executor.calls[0].text);
    expect(list).toContain('company_id = $1');
    expect(list).toContain('id = ANY($2::bigint[])');
    expect(executor.calls[0].params[1]).toEqual(['100', '200']);
  });

  it('short-circuits an empty id set without querying', async () => {
    const page = await repository.listByCompanyAndBranchIds(
      '10',
      [],
      resolvePagination(),
    );
    expect(page).toEqual({ items: [], total: 0 });
    expect(executor.calls).toHaveLength(0);
  });

  it('scopes a single read by id AND company_id AND deleted_at', async () => {
    executor.queueRows([row]);
    await repository.findInCompany('10', '100');

    const find = norm(executor.calls[0].text);
    expect(find).toContain('WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL');
    expect(executor.calls[0].params).toEqual(['100', '10']);
  });

  it('inserts with the tenant company id and returns the mapped branch', async () => {
    executor.queueRows([row]);
    const created = await repository.create('10', {
      cityId: '5',
      nameAr: 'فرع',
      nameFr: 'Agence',
    });
    expect(norm(executor.calls[0].text)).toContain('INSERT INTO public.branches');
    expect(executor.calls[0].params).toEqual(['10', '5', 'فرع', 'Agence', null]);
    expect(created.id).toBe('100');
  });

  it('transitions activation atomically with the opposite-state precondition', async () => {
    executor.queueRows([{ ...row, is_active: true }]);
    await repository.transitionActive('10', '100', true);

    const sql = norm(executor.calls[0].text);
    expect(sql).toContain('UPDATE public.branches');
    expect(sql).toContain('company_id = $2');
    expect(sql).toContain('is_active = NOT $3');
    expect(executor.calls[0].params).toEqual(['100', '10', true]);
  });
});
