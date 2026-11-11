import { RewardRedemptionService } from './reward-redemption.service';
import { DiscountEngine } from '../../engines/discount-engine/discount.engine';
import { TenantContext } from '../../core/tenant/tenant-context';

const TENANT = new TenantContext('t1', 'b1');
const VAT = 1.15;

const fixed = (amount: number, over: Record<string, unknown> = {}) => ({
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
    reward_config: { amount },
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
  it('20 SAR reward on a 5.75 sale consumes 5.75 (VAT included) and leaves 14.25', async () => {
    const { service } = build([fixed(20)]);
    const p = await preview(service, ['inst-1'], 5); // net 5.00 -> gross 5.75
    expect(p.fixedConsumptions).toEqual([{ instanceId: 'inst-1', amount: 5.75 }]);
    expect(p.discountAmount).toBe(5); // net discount: whole net -> total 0
    expect(20 - p.fixedConsumptions![0].amount).toBeCloseTo(14.25, 2);
  });

  it('a reward smaller than the bill is consumed entirely', async () => {
    const { service } = build([fixed(20)]);
    const p = await preview(service, ['inst-1'], 30); // gross 34.50
    expect(p.fixedConsumptions![0].amount).toBe(20);
    expect(p.discountAmount).toBeCloseTo(17.39, 2);
  });

  it('uses the remaining balance, not the original amount', async () => {
    const { service } = build([fixed(20, { remaining_amount: '14.25' })]);
    const p = await preview(service, ['inst-1'], 30);
    expect(p.fixedConsumptions![0].amount).toBe(14.25);
  });

  it('two fixed rewards are consumed in order against what is still payable', async () => {
    const { service } = build([
      fixed(3, { id: 'a' }),
      fixed(10, { id: 'b' }),
    ]);
    const p = await preview(service, ['a', 'b'], 5); // gross 5.75
    expect(p.fixedConsumptions).toEqual([
      { instanceId: 'a', amount: 3 },
      { instanceId: 'b', amount: 2.75 },
    ]);
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
