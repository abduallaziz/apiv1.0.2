import { RewardRedemptionService } from './reward-redemption.service';
import { DiscountEngine } from '../../engines/discount-engine/discount.engine';
import { TenantContext } from '../../core/tenant/tenant-context';

const TENANT = new TenantContext('t1', 'b1');
const CUSTOMER = 'cust-1';
const BRANCH = 'branch-a';

function fixedDiscountInstance(over: Record<string, unknown> = {}) {
  return {
    id: 'inst-1',
    customer_id: CUSTOMER,
    status: 'unlocked',
    expires_at: null,
    reward_definitions: {
      id: 'def-1',
      branch_scope: 'all',
      branch_id: null,
      reward_type: 'fixed_discount',
      reward_config: { amount: 10 },
      usage_conditions: {},
    },
    ...over,
  };
}

function build(overrides: { findByIdsResult?: any[]; coupon?: any } = {}) {
  const instancesRepo = {
    findByIds: jest
      .fn()
      .mockResolvedValue(
        overrides.findByIdsResult ?? [fixedDiscountInstance()],
      ),
    redeemInstances: jest.fn().mockResolvedValue([]),
    attachRedemptionOrder: jest.fn().mockResolvedValue(undefined),
  };
  const couponsService = {
    findOneOrThrow: jest.fn().mockResolvedValue(
      overrides.coupon ?? {
        discount_type: 'fixed',
        discount_value: 15,
        max_discount_amount: null,
      },
    ),
    calculateDiscount: jest.fn((coupon, subtotal) =>
      Math.min(coupon.discount_value, subtotal),
    ),
  };
  const service = new RewardRedemptionService(
    instancesRepo as any,
    new DiscountEngine(),
    couponsService as any,
  );
  return { service, instancesRepo, couponsService };
}

describe('RewardRedemptionService.previewSelection', () => {
  it('computes fixed_discount amount and does not mutate any instance', async () => {
    const { service, instancesRepo } = build();
    const result = await service.previewSelection(
      TENANT,
      CUSTOMER,
      BRANCH,
      ['inst-1'],
      100,
    );
    expect(result.discountAmount).toBe(10);
    expect(result.freeItemGrants).toEqual([]);
    expect(instancesRepo.redeemInstances).not.toHaveBeenCalled();
  });

  it('computes percentage_discount amount', async () => {
    const { service } = build({
      findByIdsResult: [
        fixedDiscountInstance({
          reward_definitions: {
            id: 'def-2',
            branch_scope: 'all',
            branch_id: null,
            reward_type: 'percentage_discount',
            reward_config: { percent: 10 },
            usage_conditions: {},
          },
        }),
      ],
    });
    const result = await service.previewSelection(
      TENANT,
      CUSTOMER,
      BRANCH,
      ['inst-1'],
      200,
    );
    expect(result.discountAmount).toBe(20);
  });

  it('sums multiple reward instances redeemed in one invoice', async () => {
    const { service } = build({
      findByIdsResult: [
        fixedDiscountInstance({
          id: 'inst-1',
          reward_definitions: {
            ...fixedDiscountInstance().reward_definitions,
            reward_config: { amount: 10 },
          },
        }),
        fixedDiscountInstance({
          id: 'inst-2',
          reward_definitions: {
            ...fixedDiscountInstance().reward_definitions,
            reward_config: { amount: 5 },
          },
        }),
      ],
    });
    const result = await service.previewSelection(
      TENANT,
      CUSTOMER,
      BRANCH,
      ['inst-1', 'inst-2'],
      100,
    );
    expect(result.discountAmount).toBe(15);
  });

  it('caps combined discount at subtotal', async () => {
    const { service } = build({
      findByIdsResult: [
        fixedDiscountInstance({
          reward_definitions: {
            id: 'def-1',
            branch_scope: 'all',
            branch_id: null,
            reward_type: 'fixed_discount',
            reward_config: { amount: 90 },
            usage_conditions: {},
          },
        }),
      ],
    });
    const result = await service.previewSelection(
      TENANT,
      CUSTOMER,
      BRANCH,
      ['inst-1'],
      50,
    );
    expect(result.discountAmount).toBe(50);
  });

  it('resolves coupon_reference via CouponsService', async () => {
    const { service, couponsService } = build({
      findByIdsResult: [
        fixedDiscountInstance({
          reward_definitions: {
            id: 'def-3',
            branch_scope: 'all',
            branch_id: null,
            reward_type: 'coupon_reference',
            reward_config: { coupon_id: 'coupon-1' },
            usage_conditions: {},
          },
        }),
      ],
    });
    const result = await service.previewSelection(
      TENANT,
      CUSTOMER,
      BRANCH,
      ['inst-1'],
      100,
    );
    expect(couponsService.findOneOrThrow).toHaveBeenCalledWith(
      TENANT,
      'coupon-1',
    );
    expect(result.discountAmount).toBe(15);
  });

  it('returns a free_item grant without discounting the invoice', async () => {
    const { service } = build({
      findByIdsResult: [
        fixedDiscountInstance({
          reward_definitions: {
            id: 'def-4',
            branch_scope: 'all',
            branch_id: null,
            reward_type: 'free_item',
            reward_config: { item_id: 'item-99' },
            usage_conditions: {},
          },
        }),
      ],
    });
    const result = await service.previewSelection(
      TENANT,
      CUSTOMER,
      BRANCH,
      ['inst-1'],
      100,
    );
    expect(result.discountAmount).toBe(0);
    expect(result.freeItemGrants).toEqual([
      { reward_instance_id: 'inst-1', item_id: 'item-99' },
    ]);
  });

  it('rejects a duplicate instance id in the same request', async () => {
    const { service } = build();
    await expect(
      service.previewSelection(
        TENANT,
        CUSTOMER,
        BRANCH,
        ['inst-1', 'inst-1'],
        100,
      ),
    ).rejects.toThrow('Duplicate reward instance selected more than once');
  });

  it('rejects an instance belonging to a different customer', async () => {
    const { service } = build({
      findByIdsResult: [fixedDiscountInstance({ customer_id: 'someone-else' })],
    });
    await expect(
      service.previewSelection(TENANT, CUSTOMER, BRANCH, ['inst-1'], 100),
    ).rejects.toThrow('does not belong to this customer');
  });

  it('rejects an already-redeemed instance', async () => {
    const { service } = build({
      findByIdsResult: [fixedDiscountInstance({ status: 'redeemed' })],
    });
    await expect(
      service.previewSelection(TENANT, CUSTOMER, BRANCH, ['inst-1'], 100),
    ).rejects.toThrow('is not available to redeem');
  });

  it('rejects an expired instance', async () => {
    const { service } = build({
      findByIdsResult: [
        fixedDiscountInstance({
          expires_at: new Date(Date.now() - 1000).toISOString(),
        }),
      ],
    });
    await expect(
      service.previewSelection(TENANT, CUSTOMER, BRANCH, ['inst-1'], 100),
    ).rejects.toThrow('has expired');
  });

  it('rejects a specific-branch reward redeemed at the wrong branch', async () => {
    const { service } = build({
      findByIdsResult: [
        fixedDiscountInstance({
          reward_definitions: {
            id: 'def-5',
            branch_scope: 'specific',
            branch_id: 'other-branch',
            reward_type: 'fixed_discount',
            reward_config: { amount: 10 },
            usage_conditions: {},
          },
        }),
      ],
    });
    await expect(
      service.previewSelection(TENANT, CUSTOMER, BRANCH, ['inst-1'], 100),
    ).rejects.toThrow('is not valid at this branch');
  });

  it('allows a specific-branch reward redeemed at its own branch', async () => {
    const { service } = build({
      findByIdsResult: [
        fixedDiscountInstance({
          reward_definitions: {
            id: 'def-6',
            branch_scope: 'specific',
            branch_id: BRANCH,
            reward_type: 'fixed_discount',
            reward_config: { amount: 10 },
            usage_conditions: {},
          },
        }),
      ],
    });
    const result = await service.previewSelection(
      TENANT,
      CUSTOMER,
      BRANCH,
      ['inst-1'],
      100,
    );
    expect(result.discountAmount).toBe(10);
  });

  it('rejects when usage_conditions.min_order_amount is not met', async () => {
    const { service } = build({
      findByIdsResult: [
        fixedDiscountInstance({
          reward_definitions: {
            id: 'def-7',
            branch_scope: 'all',
            branch_id: null,
            reward_type: 'fixed_discount',
            reward_config: { amount: 10 },
            usage_conditions: { min_order_amount: 50 },
          },
        }),
      ],
    });
    await expect(
      service.previewSelection(TENANT, CUSTOMER, BRANCH, ['inst-1'], 20),
    ).rejects.toThrow('requires a minimum order of 50');
  });

  it('rejects when one or more selected instances were not found', async () => {
    const { service } = build({ findByIdsResult: [] });
    await expect(
      service.previewSelection(TENANT, CUSTOMER, BRANCH, ['inst-1'], 100),
    ).rejects.toThrow('were not found');
  });
});

describe('RewardRedemptionService.redeemSelected / attachOrder', () => {
  it('delegates atomic redemption to the repository', async () => {
    const { service, instancesRepo } = build();
    await service.redeemSelected('t1', CUSTOMER, BRANCH, ['inst-1', 'inst-2']);
    expect(instancesRepo.redeemInstances).toHaveBeenCalledWith(
      't1',
      CUSTOMER,
      BRANCH,
      ['inst-1', 'inst-2'],
    );
  });

  it('attachOrder is a no-op for an empty selection', async () => {
    const { service, instancesRepo } = build();
    await service.attachOrder([], 'order-1');
    expect(instancesRepo.attachRedemptionOrder).not.toHaveBeenCalled();
  });

  it('attachOrder delegates to the repository for a non-empty selection', async () => {
    const { service, instancesRepo } = build();
    await service.attachOrder(['inst-1'], 'order-1');
    expect(instancesRepo.attachRedemptionOrder).toHaveBeenCalledWith(
      ['inst-1'],
      'order-1',
    );
  });
});
