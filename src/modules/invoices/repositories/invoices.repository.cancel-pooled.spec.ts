import { InvoicesRepository } from './invoices.repository';

// A swallowed "nothing to reverse" error must not abort the transaction: otherwise
// the final COMMIT silently rolls the status UPDATE back (cancel returned 200 but
// the invoice stayed completed).
describe('InvoicesRepository.cancelPooled', () => {
  const tenant = { tenantId: 't1' } as never;

  function build(reverseError?: Error) {
    const calls: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        calls.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
        if (sql.includes('UPDATE orders')) {
          return { rows: [{ id: 'o1', status: 'cancelled' }] };
        }
        if (sql.includes('fn_reverse_sales_order') && reverseError) throw reverseError;
        return { rows: [] };
      }),
    };
    const session = {
      runInTenantContext: (_t: unknown, fn: (c: unknown) => unknown) => fn(client),
    };
    const repo = new InvoicesRepository({} as never, session as never);
    return { repo, calls };
  }

  it('rolls back to the savepoint and keeps the cancellation when nothing was posted', async () => {
    const { repo, calls } = build(new Error('Order has nothing to reverse'));
    const res = await repo.cancelPooled(tenant, 'o1', 'u1', 'why');
    expect(res).toEqual({ id: 'o1', status: 'cancelled' });
    expect(calls).toContain('SAVEPOINT reverse_sale');
    expect(calls).toContain('ROLLBACK TO');
  });

  it('propagates any other reversal error', async () => {
    const { repo } = build(new Error('closed fiscal period'));
    await expect(repo.cancelPooled(tenant, 'o1', 'u1', 'why')).rejects.toThrow('closed fiscal period');
  });
});
