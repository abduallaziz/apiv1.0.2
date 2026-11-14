import { BadRequestException } from '@nestjs/common';
import { AccountingRepository } from './repositories/accounting.repository';
import { TenantContext } from '../../core/tenant/tenant-context';

function fake() {
  const calls: Record<string, unknown[][]> = {};
  const c: any = {};
  for (const m of [
    'select',
    'eq',
    'gte',
    'is',
    'lte',
    'or',
    'in',
    'order',
    'range',
  ])
    c[m] = jest.fn((...a: unknown[]) => {
      (calls[m] ||= []).push(a);
      return m === 'range'
        ? Promise.resolve({
            data: [{ id: 'e1', journal_lines: [{ id: 'l1' }] }],
            error: null,
            count: 7,
          })
        : c;
    });
  const supabase = { from: jest.fn(() => c) };
  return { repo: new AccountingRepository(supabase as any), calls };
}
const T = new TenantContext('t1', null);

describe('AccountingRepository.findJournalEntries line filters', () => {
  it('applies account/amount in the database (inner join) and keeps the true total', async () => {
    const { repo, calls } = fake();
    const res = await repo.findJournalEntries(T, {
      page: 1,
      per_page: 50,
      account_id: 'a1',
      amount_min: 5,
      amount_max: 100,
    } as any);
    expect(calls.select[0][0]).toContain('journal_lines!inner');
    expect(calls.eq).toContainEqual(['journal_lines.account_id', 'a1']);
    expect(calls.or[0][1]).toEqual({ referencedTable: 'journal_lines' });
    expect(calls.lte).toContainEqual(['journal_lines.debit_amount', 100]);
    expect(res.total).toBe(7);
    expect(res.data[0]).not.toHaveProperty('journal_lines');
  });

  it('rejects min > max and negatives', async () => {
    const { repo } = fake();
    await expect(
      repo.findJournalEntries(T, { amount_min: 50, amount_max: 10 } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      repo.findJournalEntries(T, { amount_min: -5 } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not join journal_lines when no line filter is set', async () => {
    const { repo, calls } = fake();
    await repo.findJournalEntries(T, { page: 1 } as any);
    expect(calls.select[0][0]).not.toContain('journal_lines');
  });
});
