import type { QueryResult } from 'pg';
import type { DatabaseExecutor } from '../../infrastructure/database/database.types';
import { resolvePagination } from '../../common/pagination/pagination';
import { PostgresIdentityRepository } from './postgres-identity.repository';
import { MembershipRole } from './membership-role';

const now = new Date('2026-01-01T00:00:00.000Z');
const USER_ID = '11111111-1111-1111-1111-111111111111';

function result<T>(rows: T[]): QueryResult<T & Record<string, unknown>> {
  return {
    rows: rows as (T & Record<string, unknown>)[],
    rowCount: rows.length,
    command: '',
    oid: 0,
    fields: [],
  };
}

describe('PostgresIdentityRepository', () => {
  let query: jest.Mock;
  let repository: PostgresIdentityRepository;

  // Recorded SQL text / params for the nth query (jest records every call,
  // including those served by mockResolvedValueOnce).
  const textOf = (index: number): string => query.mock.calls[index][0] as string;
  const paramsOf = (index: number): readonly unknown[] =>
    (query.mock.calls[index][1] ?? []) as readonly unknown[];

  beforeEach(() => {
    query = jest.fn().mockResolvedValue(result([]));
    const executor = { query } as unknown as DatabaseExecutor;
    repository = new PostgresIdentityRepository(executor);
  });

  it('looks a profile up by id and maps the row', async () => {
    query.mockResolvedValueOnce(
      result([
        {
          id: USER_ID,
          full_name: 'Amina',
          phone_number: null,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
      ]),
    );

    const profile = await repository.findProfileByUserId(USER_ID);

    expect(profile).toMatchObject({ id: USER_ID, fullName: 'Amina' });
    expect(textOf(0)).toContain('FROM public.profiles WHERE id = $1');
    expect(textOf(0)).not.toContain('SELECT *');
    expect(paramsOf(0)).toEqual([USER_ID]);
  });

  it('returns null when no profile row exists', async () => {
    await expect(repository.findProfileByUserId(USER_ID)).resolves.toBeNull();
  });

  it('builds a parameterized SET clause for provided fields only', async () => {
    query.mockResolvedValueOnce(result([]));
    await repository.updateProfile(USER_ID, { phoneNumber: null });

    expect(textOf(0)).toContain('phone_number = $2');
    expect(textOf(0)).not.toContain('full_name =');
    expect(paramsOf(0)).toEqual([USER_ID, null]);
  });

  it('updates both fields when both are provided', async () => {
    await repository.updateProfile(USER_ID, {
      fullName: 'New',
      phoneNumber: '+22212345678',
    });
    expect(textOf(0)).toContain('full_name = $2');
    expect(textOf(0)).toContain('phone_number = $3');
    expect(paramsOf(0)).toEqual([USER_ID, 'New', '+22212345678']);
  });

  it('scopes active membership lookups by user and company and drops unknown roles', async () => {
    query.mockResolvedValueOnce(
      result([
        membershipRow({ id: '1', role: 'BRANCH_EMPLOYEE' }),
        membershipRow({ id: '2', role: 'OWNER' }),
      ]),
    );

    const memberships = await repository.findActiveMembershipsForCompany(
      USER_ID,
      '10',
    );

    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe(MembershipRole.BranchEmployee);
    expect(textOf(0)).toContain(
      'user_id = $1 AND company_id = $2 AND is_active = true',
    );
    expect(paramsOf(0)).toEqual([USER_ID, '10']);
  });

  it('lists company memberships scoped by company id with pagination and a count', async () => {
    query
      .mockResolvedValueOnce(result([membershipViewRow()]))
      .mockResolvedValueOnce(result([{ total: '1' }]));

    const page = await repository.listCompanyMemberships('10', resolvePagination());

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ companyName: 'Voyagi', memberName: 'Amina' });
    expect(textOf(0)).toContain('WHERE m.company_id = $1');
    expect(paramsOf(0)[0]).toBe('10');
    expect(textOf(1)).toContain('WHERE company_id = $1');
  });

  it('finds a single membership scoped to both id and company id', async () => {
    query.mockResolvedValueOnce(result([membershipViewRow({ id: '4' })]));

    const membership = await repository.findCompanyMembership('10', '4');

    expect(membership?.id).toBe('4');
    expect(textOf(0)).toContain('m.id = $1 AND m.company_id = $2');
    expect(paramsOf(0)).toEqual(['4', '10']);
  });

  it('returns null for a membership row with an unknown role', async () => {
    query.mockResolvedValueOnce(result([membershipViewRow({ role: 'OWNER' })]));
    await expect(repository.findCompanyMembership('10', '4')).resolves.toBeNull();
  });
});

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    user_id: USER_ID,
    company_id: '10',
    branch_id: null,
    role: 'BRANCH_EMPLOYEE',
    is_active: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function membershipViewRow(overrides: Record<string, unknown> = {}) {
  return {
    ...membershipRow(overrides),
    company_name: 'Voyagi',
    member_name: 'Amina',
    ...overrides,
  };
}
