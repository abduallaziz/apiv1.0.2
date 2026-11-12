import { RewardRedemptionService } from './reward-redemption.service';
import { DiscountEngine } from '../../engines/discount-engine/discount.engine';
import { TenantContext } from '../../core/tenant/tenant-context';

const TENANT = new TenantContext('t1', 'b1');
const VAT = 1.15;

const fixed = (
  amount: number,
  over: Record<string, unknown> = {},
  taxMode?: 'including' | 'excluding',
) => ({
  id: 'inst-1',
  customer_id: 'cust-1',
  status: 'unlocked',
  expires_at: null,
  remaining_amount: null,
  reward_definitions: {
    id: 'def-1',
    branch_scope: 'all',
    branch_id: null,
    reward_type: 'fixed_discount',
    reward_config: taxMode ? { amount, tax_mode: taxMode } : { amount },
    usage_conditions: {},
  },
  ...over,
});

function build(instances: any[]) {
  const repo = {
    findByIds: jest.fn().mockResolvedValue(instances),
    redeemInstances: jest.fn().mockResolvedValue([]),
    consumeBalance: jest
      .fn()
      .mockImplementation(async (_t, _c, _b, id) => ({ redemption_id: `red-${id}` })),
    restoreBalance: jest.fn().mockResolvedValue(true),
    attachConsumptionOrder: jest.fn().mockResolvedValue(undefined),
  };
  const service = new RewardRedemptionService(repo as any, new DiscountEngine(), {} as any);
  return { service, repo };
}
const preview = (s: RewardRedemptionService, ids: string[], subtotal: number, netBase = subtotal) =>
  s.previewSelection(TENANT, 'cust-1', 'b1', ids, subtotal, { netBase, taxFactor: VAT });

describe('fixed-amount reward balance (preview)', () => {
  it("'including': 20 SAR on a 5.75 sale consumes 5.75 (VAT included) and leaves 14.25", async () => {
    const { service } = build([fixed(20, {}, 'including')]);
    const p = await preview(service, ['inst-1'], 5); // net 5.00 -> gross 5.75
    expect(p.fixedConsumptions).toEqual([{ instanceId: 'inst-1', amount: 5.75 }]);
    expect(p.discountAmount).toBe(5); // whole net -> total 0
    expect(20 - p.fixedConsumptions![0].amount).toBeCloseTo(14.25, 2);
  });

  it("'including' smaller than the bill: 20 off a 34.50 gross bill, net discount 17.39", async () => {
    const { service } = build([fixed(20, {}, 'including')]);
    const p = await preview(service, ['inst-1'], 30);
    expect(p.fixedConsumptions![0].amount).toBe(20);
    expect(p.discountAmount).toBeCloseTo(17.39, 2);
  });

  it("'excluding' (default): 20 SAR before VAT on a 5.00 net sale consumes 5.00 and leaves 15.00", async () => {
    const { service } = build([fixed(20)]); // no tax_mode -> excluding
    const p = await preview(service, ['inst-1'], 5);
    expect(p.fixedConsumptions).toEqual([{ instanceId: 'inst-1', amount: 5 }]);
    expect(p.discountAmount).toBe(5);
  });

  it("'excluding' smaller than the bill: the full 20 comes off the net price", async () => {
    const { service } = build([fixed(20, {}, 'excluding')]);
    const p = await preview(service, ['inst-1'], 30);
    expect(p.fixedConsumptions![0].amount).toBe(20);
    expect(p.discountAmount).toBe(20); // 30 - 20 = 10 net, VAT 1.50 -> 11.50
  });

  it('uses the remaining balance, not the original amount', async () => {
    const { service } = build([fixed(20, { remaining_amount: '14.25' }, 'including')]);
    const p = await preview(service, ['inst-1'], 30);
    expect(p.fixedConsumptions![0].amount).toBe(14.25);
  });

  it('two fixed rewards (mixed modes) are consumed in order against what is still payable', async () => {
    const { service } = build([
      fixed(3, { id: 'a' }, 'excluding'), // 3.00 net
      fixed(10, { id: 'b' }, 'including'), // rest: net 2.00 -> gross 2.30
    ]);
    const p = await preview(service, ['a', 'b'], 5);
    expect(p.fixedConsumptions).toEqual([
      { instanceId: 'a', amount: 3 },
      { instanceId: 'b', amount: 2.3 },
    ]);
    expect(p.discountAmount).toBeCloseTo(5, 2);
  });

  it('does not consume a reward when nothing is left to pay', async () => {
    const { service } = build([fixed(20)]);
    const p = await preview(service, ['inst-1'], 5, 0); // other discounts already cover everything
    expect(p.fixedConsumptions).toEqual([]);
    expect(p.discountAmount).toBe(0);
  });

  it('without a fixed base the legacy single-use behaviour is unchanged', async () => {
    const { service } = build([fixed(20)]);
    const p = await service.previewSelection(TENANT, 'cust-1', 'b1', ['inst-1'], 30);
    expect(p.discountAmount).toBe(20);
    expect(p.singleUseIds).toEqual(['inst-1']);
    expect(p.fixedConsumptions).toEqual([]);
  });

  it('percentage rewards stay single-use even when a fixed base is provided', async () => {
    const pct = fixed(0, { id: 'p' });
    (pct.reward_definitions as any).reward_type = 'percentage_discount';
    (pct.reward_definitions as any).reward_config = { percent: 10 };
    const { service } = build([pct]);
    const p = await preview(service, ['p'], 100);
    expect(p.singleUseIds).toEqual(['p']);
    expect(p.fixedConsumptions).toEqual([]);
  });
});

describe('fixed-amount reward balance (consume / undo)', () => {
  it('consumeFixed returns redemption ids in order', async () => {
    const { service, repo } = build([]);
    const ids = await service.consumeFixed('t1', 'c1', 'b1', [
      { instanceId: 'a', amount: 1 },
      { instanceId: 'b', amount: 2 },
    ], 'attempt-1');
    expect(ids).toEqual(['red-a', 'red-b']);
    expect(repo.consumeBalance).toHaveBeenCalledWith('t1', 'c1', 'b1', 'a', 1, 'attempt-1');
  });

  it('undoes the ones already consumed when a later one fails', async () => {
    const { service, repo } = build([]);
    repo.consumeBalance
      .mockImplementationOnce(async () => ({ redemption_id: 'red-a' }))
      .mockImplementationOnce(async () => {
        throw new Error('insufficient');
      });
    await expect(
      service.consumeFixed('t1', 'c1', 'b1', [
        { instanceId: 'a', amount: 1 },
        { instanceId: 'b', amount: 2 },
      ]),
    ).rejects.toThrow('insufficient');
    expect(repo.restoreBalance).toHaveBeenCalledWith('t1', 'red-a');
  });

  it('restoreConsumptions and attachConsumptions delegate to the repository', async () => {
    const { service, repo } = build([]);
    await service.restoreConsumptions('t1', ['r1', 'r2']);
    expect(repo.restoreBalance).toHaveBeenCalledTimes(2);
    await service.attachConsumptions(['r1'], 'order-1');
    expect(repo.attachConsumptionOrder).toHaveBeenCalledWith(['r1'], 'order-1');
    await service.attachConsumptions([], 'order-1');
    expect(repo.attachConsumptionOrder).toHaveBeenCalledTimes(1);
  });
});

describe('free_item reward with one or several products', () => {
  const freeItem = (cfg: Record<string, unknown>) => ({
    id: 'fi-1',
    customer_id: 'cust-1',
    status: 'unlocked',
    expires_at: null,
    reward_definitions: {
      id: 'def-f',
      branch_scope: 'all',
      branch_id: null,
      reward_type: 'free_item',
      reward_config: cfg,
      usage_conditions: {},
    },
  });
  const grants = async (cfg: Record<string, unknown>) => {
    const { service } = build([freeItem(cfg)]);
    return service.previewSelection(TENANT, 'cust-1', 'b1', ['fi-1'], 10);
  };

  it('a single item_id (older rewards) is granted', async () => {
    const p = await grants({ item_id: 'coffee' });
    expect(p.freeItemGrants).toEqual([{ reward_instance_id: 'fi-1', item_id: 'coffee' }]);
    expect(p.singleUseIds).toEqual(['fi-1']);
  });

  it('several item_ids are all granted by the one reward instance', async () => {
    const p = await grants({ item_id: 'coffee', item_ids: ['coffee', 'cake'] });
    expect(p.freeItemGrants.map((g) => g.item_id)).toEqual(['coffee', 'cake']);
    expect(p.discountAmount).toBe(0);
  });

  it('rejects a free-item reward with no product configured', async () => {
    await expect(grants({ item_id: '', item_ids: [] })).rejects.toThrow(/no item configured/);
  });
});
