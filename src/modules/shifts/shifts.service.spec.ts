import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { ShiftEngine } from '../../engines/shift-engine/shift.engine';
import { TenantContext } from '../../core/tenant/tenant.context';

const TENANT = new TenantContext('tenant-1', null);
const SHIFT = {
  id: 'shift-1',
  tenant_id: 'tenant-1',
  status: 'open',
  cashier_id: 'user-1',
  branch_id: 'branch-1',
  opening_cash: 100,
  opened_at: '2026-11-09T10:00:00.000Z',
  notes: null,
};

function build(overrides: Record<string, jest.Mock> = {}) {
  const repo = {
    findById: jest.fn().mockResolvedValue(SHIFT),
    findOpenByUser: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ ...SHIFT, id: 'new-shift' }),
    getShiftInvoices: jest.fn().mockResolvedValue([
      { total: 28.75, payment_method: 'cash' },
      { total: 5.75, payment_method: 'mada' },
    ]),
    getShiftExpenses: jest.fn().mockResolvedValue([]),
    getShiftReturns: jest.fn().mockResolvedValue([
      { refund_method: 'cash', refund_cash: 10, refund_noncash: 0, refund_total: 10 },
    ]),
    getShiftOrderExtras: jest.fn().mockResolvedValue({
      discountTotal: 0,
      taxTotal: 4.5,
      itemsCount: 2,
      cancelled: { count: 0, amount: 0 },
    }),
    getNames: jest.fn().mockResolvedValue({ cashierName: 'C', branchName: 'B' }),
    closeAtomic: jest.fn().mockResolvedValue({ ...SHIFT, status: 'closed' }),
    ...overrides,
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const metrics = { recordShift: jest.fn() };
  const notification = { notify: jest.fn().mockResolvedValue(undefined) };
  const service = new ShiftsService(
    repo as never,
    new ShiftEngine(),
    audit as never,
    metrics as never,
    notification as never,
    {} as never,
    {} as never,
  );
  return { service, repo, audit };
}

const CLOSE = (service: ShiftsService, counts = { cash: 118.75 }) =>
  service.closeShift(
    'shift-1',
    { counts } as never,
    TENANT,
    'user-1',
    'cashier',
    'ip',
    'dev',
  );

describe('ShiftsService.assertOpenSession (S2: a register of THIS cashier and THIS branch)', () => {
  it('accepts the cashier\'s own open register in the right branch', async () => {
    const { service } = build();
    await expect(
      service.assertOpenSession('tenant-1', 'shift-1', 'user-1', 'branch-1'),
    ).resolves.toBeUndefined();
  });

  it("rejects another cashier's open register", async () => {
    const { service } = build();
    await expect(
      service.assertOpenSession('tenant-1', 'shift-1', 'someone-else', 'branch-1'),
    ).rejects.toThrow('another cashier');
  });

  it('rejects a register of another branch', async () => {
    const { service } = build();
    await expect(
      service.assertOpenSession('tenant-1', 'shift-1', 'user-1', 'branch-2'),
    ).rejects.toThrow('another branch');
  });

  it('still rejects a missing id and a closed register', async () => {
    const { service, repo } = build();
    await expect(service.assertOpenSession('tenant-1', null)).rejects.toThrow('NO_ACTIVE_CASH_SESSION');
    repo.findById.mockResolvedValue({ ...SHIFT, status: 'closed' });
    await expect(
      service.assertOpenSession('tenant-1', 'shift-1', 'user-1', 'branch-1'),
    ).rejects.toThrow('not open');
  });
});

describe('ShiftsService.openShift (S1: one open register per cashier)', () => {
  const open = (service: ShiftsService) =>
    service.openShift({ branch_id: 'branch-1', opening_cash: 0 } as never, TENANT, 'user-1', 'cashier', 'ip', 'dev');

  it('rejects when the cashier already has an open register', async () => {
    const { service, repo } = build();
    repo.findOpenByUser.mockResolvedValue(SHIFT);
    await expect(open(service)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('two simultaneous opens: the unique index violation becomes a clean 400', async () => {
    const { service, repo } = build();
    repo.create.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "uq_shifts_one_open_per_cashier"'),
    );
    await expect(open(service)).rejects.toThrow('already open');
  });

  it('other database errors are not swallowed', async () => {
    const { service, repo } = build();
    repo.create.mockRejectedValue(new Error('connection lost'));
    await expect(open(service)).rejects.toThrow('connection lost');
  });
});

describe('ShiftsService.closeShift (S6: atomic close with a fingerprint)', () => {
  it('closes through ONE database call carrying the counts and the activity fingerprint', async () => {
    const { service, repo } = build();
    await CLOSE(service);
    expect(repo.closeAtomic).toHaveBeenCalledTimes(1);
    const arg = repo.closeAtomic.mock.calls[0][0];
    expect(arg.shiftId).toBe('shift-1');
    expect(arg.fingerprint).toEqual({
      orders: 2,
      ordersTotal: 34.5,
      returns: 1,
      returnsTotal: 10,
    });
    expect(arg.counts.map((c: { payment_method: string }) => c.payment_method)).toEqual([
      'cash',
      'mada',
      'visa',
      'mastercard',
    ]);
    // cash expected = 100 + 28.75 - 10 (cash refund)
    expect(arg.expectedCash).toBeCloseTo(118.75, 2);
  });

  it('a sale slipped in (SHIFT_ACTIVITY_CHANGED): the figures are recomputed and it retries', async () => {
    const { service, repo } = build();
    repo.closeAtomic
      .mockRejectedValueOnce({ message: 'SHIFT_ACTIVITY_CHANGED' })
      .mockResolvedValueOnce({ ...SHIFT, status: 'closed' });
    await CLOSE(service);
    expect(repo.closeAtomic).toHaveBeenCalledTimes(2);
    expect(repo.getShiftInvoices).toHaveBeenCalledTimes(2);
  });

  it('gives up with a clear 400 after 3 changed attempts and never records an audit row', async () => {
    const { service, repo, audit } = build();
    repo.closeAtomic.mockRejectedValue({ message: 'SHIFT_ACTIVITY_CHANGED' });
    await expect(CLOSE(service)).rejects.toThrow('kept changing');
    expect(repo.closeAtomic).toHaveBeenCalledTimes(3);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('an already closed register (lost race) is a 400, not a 500', async () => {
    const { service, repo } = build();
    repo.closeAtomic.mockRejectedValue({ message: 'Shift already closed' });
    await expect(CLOSE(service)).rejects.toThrow('Shift already closed');
    expect(repo.closeAtomic).toHaveBeenCalledTimes(1);
  });

  it('only the cashier who owns the register can close it, and it must exist', async () => {
    const { service, repo } = build();
    repo.findById.mockResolvedValue({ ...SHIFT, cashier_id: 'other' });
    await expect(CLOSE(service)).rejects.toThrow('Not your shift');
    repo.findById.mockResolvedValue(null);
    await expect(CLOSE(service)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.closeAtomic).not.toHaveBeenCalled();
  });

  it('unexpected database errors are rethrown unchanged', async () => {
    const { service, repo } = build();
    repo.closeAtomic.mockRejectedValue(new Error('boom'));
    await expect(CLOSE(service)).rejects.toThrow('boom');
  });
});

describe('ShiftsService.getCurrentShift (phase 4: the register OPENED BY THIS USER)', () => {
  it("returns the user's own open register even when a branch is selected, never another cashier's", async () => {
    const { service, repo } = build();
    (repo as Record<string, unknown>).findCurrentByBranch = jest.fn().mockResolvedValue({ ...SHIFT, cashier_id: 'other' });
    repo.findOpenByUser.mockResolvedValue(SHIFT);
    const r = await service.getCurrentShift(TENANT, 'user-1', 'branch-1');
    expect(r).toEqual(SHIFT);
    expect(repo.findOpenByUser).toHaveBeenCalledWith('user-1', 'tenant-1');
    expect(
      (repo as unknown as { findCurrentByBranch: jest.Mock }).findCurrentByBranch,
    ).not.toHaveBeenCalled();
  });

  it('null when the user has no open register', async () => {
    const { service } = build();
    expect(await service.getCurrentShift(TENANT, 'user-1', 'branch-1')).toBeNull();
  });
});
