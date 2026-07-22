import { Logger } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseErrorMapper } from './database-error.mapper';
import {
  DatabaseConnectionError,
  UniqueConstraintViolationError,
} from './database.errors';
import {
  IsolationLevel,
  TransactionManager,
} from './transaction.manager';

interface FakeClient extends PoolClient {
  queries: string[];
}

function createClient(
  behavior: { failOn?: string } = {},
): { client: FakeClient; release: jest.Mock } {
  const queries: string[] = [];
  const release = jest.fn();
  const query = jest.fn((sql: string) => {
    queries.push(sql);
    if (behavior.failOn && sql.startsWith(behavior.failOn)) {
      return Promise.reject(new Error(`fail:${sql}`));
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  const client = { query, release, queries } as unknown as FakeClient;
  return { client, release };
}

function managerFor(client: FakeClient): TransactionManager {
  const pool = { connect: jest.fn().mockResolvedValue(client) };
  return new TransactionManager(
    pool as unknown as Pool,
    new DatabaseErrorMapper(),
  );
}

describe('TransactionManager', () => {
  it('translates pool acquisition failures to a dependency error', async () => {
    const pool = {
      connect: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })),
    };
    const manager = new TransactionManager(
      pool as unknown as Pool,
      new DatabaseErrorMapper(),
    );

    await expect(manager.run(async () => undefined)).rejects.toBeInstanceOf(
      DatabaseConnectionError,
    );
  });

  it('commits on success and releases the client', async () => {
    const { client, release } = createClient();
    const manager = managerFor(client);

    const result = await manager.run(async (tx) => {
      await tx.query('SELECT 1');
      return 'done';
    });

    expect(result).toBe('done');
    expect(client.queries).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('applies a requested isolation level', async () => {
    const { client } = createClient();
    const manager = managerFor(client);

    await manager.run(async () => undefined, {
      isolationLevel: IsolationLevel.Serializable,
    });

    expect(client.queries[0]).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
  });

  it('rolls back on failure and releases the client', async () => {
    const { client, release } = createClient();
    const manager = managerFor(client);

    await expect(
      manager.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(client.queries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('translates driver errors thrown inside the transaction', async () => {
    const { client } = createClient();
    const manager = managerFor(client);

    await expect(
      manager.run(async (tx) => {
        // The fake client throws a coded driver error for this query.
        (client.query as jest.Mock).mockRejectedValueOnce(
          Object.assign(new Error('dup'), { code: '23505' }),
        );
        await tx.query('INSERT ...');
      }),
    ).rejects.toBeInstanceOf(UniqueConstraintViolationError);

    expect(client.queries).toContain('ROLLBACK');
  });

  it('does not mask the primary error when rollback itself fails', async () => {
    const { client, release } = createClient({ failOn: 'ROLLBACK' });
    const manager = managerFor(client);
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(
      manager.run(async () => {
        throw new Error('primary failure');
      }),
    ).rejects.toThrow('primary failure');

    expect(loggerSpy).toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    loggerSpy.mockRestore();
  });
});
