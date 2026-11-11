import { BadRequestException } from '@nestjs/common';
import { ExpensesV2Service } from './expenses-v2.service';
import { ShiftsRepository } from '../shifts/shifts.repository';

// Phase 5 / T8 (owner approved 2026-11-09): a PAID CASH expense may be linked
// to the OPEN register (in the expense's branch) the cash was taken from; the
// register's expected cash then drops by the cash that left the drawer.

const TENANT = 't1';
const BRANCH = 'b1';
const SHIFT = { id: 's1', status: 'open', branch_id: BRANCH };

function build(shift: unknown = SHIFT) {
  const inserted: Record<string, unknown>[] = [];
  const supabase = {
    from: jest.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = jest.fn(self);
      chain.eq = jest.fn(self);
      chain.is = jest.fn(self);
      chain.maybeSingle = jest.fn(() => Promise.resolve({ data: shift, error: null }));
      chain.single = jest.fn(() =>
        Promise.resolve({ data: table === 'tenants' ? { tax_rate: 0.15 } : inserted[inserted.length - 1], error: null }),
      );
      chain.insert = jest.fn((row: Record<string, unknown>) => {
        inserted.push(row);
        return chain;
      });
      return chain;
    }),
  };
  const service = new ExpensesV2Service(supabase as never, { log: jest.fn().mockResolvedValue(undefined) } as never);
  jest
    .spyOn(service as unknown as { assertActiveMaster: () => Promise<void> }, 'assertActiveMaster')
    .mockResolvedValue(undefined);
  return { service, inserted };
}

const DTO = {
  department_id: 'd',
  category_id: 'c',
  title: 'Water',
  amount: 100,
  tax_mode: 'exclusive' as const,
  payment_method: 'cash',
};

describe('ExpensesV2Service.create - register link (phase 5)', () => {
  it('links a paid cash expense to the open register of its branch', async () => {
    const { service, inserted } = build();
    await service.create(TENANT, BRANCH, 'u1', { ...DTO, shift_id: 's1' });
    expect(inserted[0].shift_id).toBe('s1');
  });

  it('no shift_id = no link (cash from a safe / petty cash)', async () => {
    const { service, inserted } = build();
    await service.create(TENANT, BRANCH, 'u1', { ...DTO });
    expect(inserted[0].shift_id).toBeNull();
  });

  it('accepts "Cash" in any case', async () => {
    const { service, inserted } = build();
    await service.create(TENANT, BRANCH, 'u1', { ...DTO, payment_method: 'Cash', shift_id: 's1' });
    expect(inserted[0].shift_id).toBe('s1');
  });

  it('rejects a register for a non-cash expense', async () => {
    const { service } = build();
    await expect(
      service.create(TENANT, BRANCH, 'u1', { ...DTO, payment_method: 'card', shift_id: 's1' }),
    ).rejects.toThrow('cash expense');
  });

  it('rejects an unpaid cash expense (the cash has not left the drawer)', async () => {
    const { service } = build();
    await expect(
      service.create(TENANT, BRANCH, 'u1', { ...DTO, payment_status: 'unpaid', shift_id: 's1' }),
    ).rejects.toThrow('paid expense');
  });

  it('rejects a closed register, an unknown one and one of another branch', async () => {
    await expect(
      build({ ...SHIFT, status: 'closed' }).service.create(TENANT, BRANCH, 'u1', { ...DTO, shift_id: 's1' }),
    ).rejects.toThrow('not open');
    await expect(
      build(null).service.create(TENANT, BRANCH, 'u1', { ...DTO, shift_id: 's1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      build({ ...SHIFT, branch_id: 'other' }).service.create(TENANT, BRANCH, 'u1', { ...DTO, shift_id: 's1' }),
    ).rejects.toThrow('another branch');
  });
});

describe('ShiftsRepository.getShiftExpenses - from expenses_v2 (phase 5)', () => {
  const repoWith = (rows: unknown[]) => {
    const calls: [string, unknown[]][] = [];
    const chain: Record<string, unknown> = {};
    const rec = (name: string) =>
      jest.fn((...args: unknown[]) => {
        calls.push([name, args]);
        return chain;
      });
    chain.select = rec('select');
    chain.eq = rec('eq');
    chain.is = rec('is');
    chain.in = rec('in');
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
    const supabase = { from: jest.fn(() => chain) };
    return { repo: new ShiftsRepository(supabase as never), calls, supabase };
  };

  it('reads the register-linked, paid, approved, non-cancelled CASH expenses and returns the cash that left the drawer (VAT included)', async () => {
    const { repo, calls, supabase } = repoWith([
      { total_amount: 115, payment_method: 'cash' },
      { total_amount: 57.5, payment_method: 'Cash' },
      { total_amount: 300, payment_method: 'card' },
    ]);
    const r = await repo.getShiftExpenses('s1', 't1');
    expect(supabase.from).toHaveBeenCalledWith('expenses_v2');
    expect(calls).toContainEqual(['eq', ['shift_id', 's1']]);
    expect(calls).toContainEqual(['eq', ['payment_status', 'paid']]);
    expect(calls).toContainEqual(['is', ['cancelled_at', null]]);
    expect(r).toEqual([
      { amount: 115, status: 'approved' },
      { amount: 57.5, status: 'approved' },
    ]);
  });
});
