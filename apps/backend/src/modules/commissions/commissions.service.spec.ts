import type { DatabaseService } from '../../infrastructure/database';
import { MembershipRole } from '../identity/membership-role';
import type { CommissionsRepository } from './commissions.repository';
import { CommissionsService } from './commissions.service';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const pagination = { page: 1, pageSize: 20, limit: 20, offset: 0 };

describe('CommissionsService listTransactions', () => {
  function createService(memberships: Awaited<ReturnType<CommissionsRepository['findActorMemberships']>>) {
    const repository = {
      findActorMemberships: jest.fn().mockResolvedValue(memberships),
      listForCompany: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    } as unknown as CommissionsRepository;
    return {
      repository,
      service: new CommissionsService(repository, {} as DatabaseService),
    };
  }

  it('gives a manager tenant-wide commission visibility', async () => {
    const { repository, service } = createService([
      { id: '8', role: MembershipRole.CompanyManager },
    ]);

    await service.listTransactions(ACTOR_ID, '4', pagination);

    expect(repository.listForCompany).toHaveBeenCalledWith(
      expect.anything(),
      '4',
      { companyWide: true, agentMembershipIds: [] },
      pagination,
    );
  });

  it('restricts an agent to its own active AGENT memberships', async () => {
    const { repository, service } = createService([
      { id: '8', role: MembershipRole.Agent },
      { id: '9', role: MembershipRole.BranchEmployee },
    ]);

    await service.listTransactions(ACTOR_ID, '4', pagination);

    expect(repository.listForCompany).toHaveBeenCalledWith(
      expect.anything(),
      '4',
      { companyWide: false, agentMembershipIds: ['8'] },
      pagination,
    );
  });
});
