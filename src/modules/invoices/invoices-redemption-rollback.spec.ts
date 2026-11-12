import { BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { PosEngine } from '../../engines/pos-engine/pos.engine';
import { DiscountEngine } from '../../engines/discount-engine/discount.engine';
import { TenantContext } from '../../core/tenant/tenant-context';
import { LoyaltyService } from '../../core/loyalty/loyalty.service';

// A sale that fails AFTER a reward was redeemed must give the reward back, and a
// sale whose total would be zero must be rejected BEFORE anything is redeemed.
function build(opts: {
  previewDiscount: number;
  createFails?: boolean;
  grants?: Array<{ reward_instance_id: string; item_id: string }>;
  warehouse?: string | null;
}) {
  const repo = {
    findBySaleAttemptId: jest.fn().mockResolvedValue(null),
    create: opts.createFails
      ? jest.fn().mockRejectedValue(new Error('db exploded'))
      : jest.fn().mockResolvedValue({ id: 'order-1' }),
    insertItems: jest.fn().mockResolvedValue([]),
    createWithItemsPooled: opts.createFails
      ? jest.fn().mockRejectedValue(new Error('db exploded'))
      : jest.fn().mockResolvedValue({ id: 'order-1' }),
    getBranchDefaultWarehouse: jest.fn().mockResolvedValue(opts.warehouse ?? null),
    deductStockForSale: jest.fn().mockResolvedValue(undefined),
    getItemBasics: jest
      .fn()
      .mockResolvedValue(new Map([['shirt', { name: 'Shirt', price: 60 }]])),
  };
  const rewards = {
    previewSelection: jest
      .fn()
      .mockResolvedValue({
        discountAmount: opts.previewDiscount,
        freeItemGrants: opts.grants ?? [],
      }),
    redeemSelected: jest.fn().mockResolvedValue([]),
    releaseSelected: jest.fn().mockResolvedValue(1),
    attachOrder: jest.fn().mockResolvedValue(undefined),
  };
  const service = new InvoicesService(
    repo as any,
    new PosEngine(new DiscountEngine()),
    { processCashPayment: jest.fn() } as any,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    { recordInvoice: jest.fn() } as any,
    {
      getTaxRate: jest.fn().mockResolvedValue(0),
      getTaxConfig: jest.fn().mockResolvedValue({ tax_rate: 0, tax_inclusive_pricing: false }),
    } as any,
    { getSettings: jest.fn().mockResolvedValue({ enabled: false }) } as any,
    {} as any,
    {
      findById: jest.fn().mockResolvedValue({ id: 'c1' }),
      findByIdUnrestricted: jest.fn().mockResolvedValue({ id: 'c1', loyalty_points: 0 }),
      recordBranchActivity: jest.fn().mockResolvedValue(undefined),
    } as any,
    { notify: jest.fn().mockResolvedValue(undefined) } as any,
    { delByPrefix: jest.fn().mockResolvedValue(undefined) } as any,
    { get: jest.fn(() => false) } as any,
    { assertOpenSession: jest.fn().mockResolvedValue(undefined) } as any,
    {} as any,
    {} as any,
    {} as any,
    { findSoldByOrder: jest.fn().mockResolvedValue([]) } as any,
    {
      resolvePrice: jest
        .fn()
        .mockResolvedValue({ kind: 'no_override', officialUnitPrice: 5 }),
    } as any,
    { onOrderCompleted: jest.fn().mockResolvedValue(undefined) } as any,
    rewards as any,
    {} as any,
  );
  return { service, repo, rewards };
}

const dto = () =>
  ({
    branch_id: 'b1',
    sale_attempt_id: 'attempt-1',
    customer_id: 'c1',
    items: [{ item_id: 'i1', item_name: 'Coffee', quantity: 1, unit_price: 5 }],
    payment_method: 'cash',
    cash_tendered: 100,
    redeem_reward_instance_ids: ['r1'],
  }) as any;
const call = (s: InvoicesService) =>
  s.create(new TenantContext('t1', 'b1'), dto(), 'u1', 'cashier', 'b1', 'shift-1', '1.1.1.1', 'dev');

describe('InvoicesService.create — reward redemption safety', () => {
  it('allows a free sale (total 0) and needs no tendered cash', async () => {
    const { service, rewards, repo } = build({ previewDiscount: 5 }); // covers the whole 5.00
    const free = { ...dto(), cash_tendered: undefined };
    await expect(
      service.create(new TenantContext('t1', 'b1'), free, 'u1', 'cashier', 'b1', 'shift-1', '1.1.1.1', 'dev'),
    ).resolves.toBeDefined();
    expect(rewards.redeemSelected).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('gives the reward back when order creation fails after redemption', async () => {
    const { service, rewards } = build({ previewDiscount: 2, createFails: true });
    await expect(call(service)).rejects.toThrow('db exploded');
    expect(rewards.redeemSelected).toHaveBeenCalledTimes(1);
    expect(rewards.releaseSelected).toHaveBeenCalledWith('t1', 'c1', ['r1']);
  });

  it('does not release anything when the sale succeeds', async () => {
    const { service, rewards } = build({ previewDiscount: 2 });
    await expect(call(service)).resolves.toBeDefined();
    expect(rewards.redeemSelected).toHaveBeenCalledTimes(1);
    expect(rewards.releaseSelected).not.toHaveBeenCalled();
  });
});

describe('InvoicesService.create — free-item reward becomes a $0 stock line', () => {
  const grants = [{ reward_instance_id: 'r1', item_id: 'shirt' }];

  it('adds the free item as a 0-priced order line without changing the totals', async () => {
    const { service, repo } = build({ previewDiscount: 0, grants });
    await service.create(new TenantContext('t1', 'b1'), dto(), 'u1', 'cashier', 'b1', 'shift-1', '1.1.1.1', 'dev');
    const header = repo.create.mock.calls[0][1];
    expect(header.subtotal).toBe(5);
    expect(header.total).toBe(5);
    const lines = repo.insertItems.mock.calls[0][0];
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({
      item_id: 'shirt',
      item_name: 'Shirt',
      quantity: 1,
      unit_price: 0,
      total_price: 0,
      official_price_snapshot: 60,
    });
  });

  it('sends the free item to stock deduction too', async () => {
    const { service, repo } = build({ previewDiscount: 0, grants, warehouse: 'w1' });
    await service.create(new TenantContext('t1', 'b1'), dto(), 'u1', 'cashier', 'b1', 'shift-1', '1.1.1.1', 'dev');
    const sent = repo.deductStockForSale.mock.calls[0][4];
    expect(sent.map((i: any) => i.item_id)).toEqual(['i1', 'shirt']);
  });

  it('rejects before redeeming when the free item no longer exists', async () => {
    const { service, repo, rewards } = build({ previewDiscount: 0, grants });
    repo.getItemBasics.mockResolvedValue(new Map());
    await expect(call(service)).rejects.toThrow(/no longer exists/);
    expect(rewards.redeemSelected).not.toHaveBeenCalled();
  });
});

describe('LoyaltyService.restoreRedeemedPoints', () => {
  const fake = (rows: { points: number }, updateHits: boolean[]) => {
    const writes: Array<{ table: string; op: string; row: any }> = [];
    const from = (table: string) => {
      let op = 'select';
      let row: any;
      const q: any = {};
      q.select = () => q;
      q.insert = (r: any) => ((op = 'insert'), (row = r), writes.push({ table, op, row }), Promise.resolve({ error: null }));
      q.update = (r: any) => ((op = 'update'), (row = r), q);
      q.eq = () => q;
      q.maybeSingle = () => Promise.resolve({ data: { loyalty_points: rows.points }, error: null });
      q.then = (res: any) => {
        if (op === 'update') {
          const hit = updateHits.shift() ?? true;
          if (hit) writes.push({ table, op, row });
          return Promise.resolve({ data: hit ? [{ id: 'c1' }] : [], error: null }).then(res);
        }
        return Promise.resolve({ data: [], error: null }).then(res);
      };
      return q;
    };
    return { from, writes };
  };

  it('adds the points back, never touches lifetime, and writes an adjustment ledger row', async () => {
    const s = fake({ points: 10 }, [true]);
    const svc = new LoyaltyService(s as any, {} as any, {} as any);
    await expect(svc.restoreRedeemedPoints('t1', 'c1', 25, { branchId: 'b1' })).resolves.toBe(true);
    const upd = s.writes.find((w) => w.op === 'update');
    expect(upd?.row).toEqual({ loyalty_points: 35 });
    expect(JSON.stringify(upd?.row)).not.toContain('lifetime');
    const led = s.writes.find((w) => w.table === 'loyalty_ledger');
    expect(led?.row).toMatchObject({ type: 'adjustment', delta: 25, customer_id: 'c1' });
  });

  it('retries when the balance changed concurrently, then gives up cleanly', async () => {
    const s = fake({ points: 10 }, [false, false, false]);
    const svc = new LoyaltyService(s as any, {} as any, {} as any);
    await expect(svc.restoreRedeemedPoints('t1', 'c1', 5)).resolves.toBe(false);
  });

  it('ignores non-positive amounts', async () => {
    const svc = new LoyaltyService({} as any, {} as any, {} as any);
    await expect(svc.restoreRedeemedPoints('t1', 'c1', 0)).resolves.toBe(false);
  });
});
