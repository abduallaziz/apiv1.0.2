import { RewardEligibilityService } from './reward-eligibility.service';
import { TenantContext } from '../../core/tenant/tenant-context';

const TENANT = new TenantContext('t1', 'b1');

function build(overrides: { definitions?: any[]; categoryIds?: Set<string> }) {
  const definitionsRepo = {
    findActiveByTriggerTypes: jest
      .fn()
      .mockResolvedValue(overrides.definitions ?? []),
    findActiveByTriggerType: jest
      .fn()
      .mockResolvedValue(overrides.definitions ?? []),
  };
  const instancesRepo = {
    processPurchaseEvent: jest.fn().mockResolvedValue([]),
    processSpendThresholdEvent: jest.fn().mockResolvedValue([]),
    processLoyaltyPointsEvent: jest.fn().mockResolvedValue([]),
    getItemCategoryIds: jest
      .fn()
      .mockResolvedValue(overrides.categoryIds ?? new Set()),
  };
  const service = new RewardEligibilityService(
    definitionsRepo as any,
    instancesRepo as any,
  );
  return { service, definitionsRepo, instancesRepo };
}

const baseEvent = {
  customerId: 'cust-1',
  branchId: 'b1',
  orderId: 'order-1',
  orderTotal: 100,
  itemIds: ['item-1', 'item-2'],
};

describe('RewardEligibilityService.onOrderCompleted', () => {
  it('does nothing when there are no active order-evaluated definitions', async () => {
    const { service, instancesRepo } = build({ definitions: [] });
    await service.onOrderCompleted(TENANT, baseEvent);
    expect(instancesRepo.processPurchaseEvent).not.toHaveBeenCalled();
    expect(instancesRepo.processSpendThresholdEvent).not.toHaveBeenCalled();
  });

  it('queries purchase_count, spend_threshold, and product_category together in one lookup', async () => {
    const { service, definitionsRepo } = build({ definitions: [] });
    await service.onOrderCompleted(TENANT, baseEvent);
    expect(definitionsRepo.findActiveByTriggerTypes).toHaveBeenCalledWith(
      TENANT,
      ['purchase_count', 'spend_threshold', 'product_category'],
    );
  });

  it('evaluates a purchase_count definition via processPurchaseEvent', async () => {
    const { service, instancesRepo } = build({
      definitions: [{ id: 'def-1', trigger_type: 'purchase_count' }],
    });
    await service.onOrderCompleted(TENANT, baseEvent);
    expect(instancesRepo.processPurchaseEvent).toHaveBeenCalledWith(
      't1',
      'cust-1',
      'def-1',
      'order-1',
      'b1',
    );
  });

  it('evaluates a spend_threshold definition via processSpendThresholdEvent with the order total', async () => {
    const { service, instancesRepo } = build({
      definitions: [{ id: 'def-2', trigger_type: 'spend_threshold' }],
    });
    await service.onOrderCompleted(TENANT, baseEvent);
    expect(instancesRepo.processSpendThresholdEvent).toHaveBeenCalledWith(
      't1',
      'cust-1',
      'def-2',
      'order-1',
      100,
      'b1',
    );
  });

  it('evaluates a matching product_category definition via processPurchaseEvent', async () => {
    const { service, instancesRepo } = build({
      definitions: [
        {
          id: 'def-3',
          trigger_type: 'product_category',
          trigger_config: { category_id: 'cat-1', count: 3 },
        },
      ],
      categoryIds: new Set(['cat-1']),
    });
    await service.onOrderCompleted(TENANT, baseEvent);
    expect(instancesRepo.getItemCategoryIds).toHaveBeenCalledWith(TENANT, [
      'item-1',
      'item-2',
    ]);
    expect(instancesRepo.processPurchaseEvent).toHaveBeenCalledWith(
      't1',
      'cust-1',
      'def-3',
      'order-1',
      'b1',
    );
  });

  it('skips a product_category definition when the order has no matching category', async () => {
    const { service, instancesRepo } = build({
      definitions: [
        {
          id: 'def-3',
          trigger_type: 'product_category',
          trigger_config: { category_id: 'cat-1', count: 3 },
        },
      ],
      categoryIds: new Set(['some-other-category']),
    });
    await service.onOrderCompleted(TENANT, baseEvent);
    expect(instancesRepo.processPurchaseEvent).not.toHaveBeenCalled();
  });

  it('does not look up categories at all when no product_category definition is active', async () => {
    const { service, instancesRepo } = build({
      definitions: [{ id: 'def-1', trigger_type: 'purchase_count' }],
    });
    await service.onOrderCompleted(TENANT, baseEvent);
    expect(instancesRepo.getItemCategoryIds).not.toHaveBeenCalled();
  });

  it('is best-effort: one definition failing does not stop the others or throw', async () => {
    const { service, instancesRepo } = build({
      definitions: [
        { id: 'def-1', trigger_type: 'purchase_count' },
        { id: 'def-2', trigger_type: 'spend_threshold' },
      ],
    });
    instancesRepo.processPurchaseEvent.mockRejectedValueOnce(new Error('boom'));
    await expect(
      service.onOrderCompleted(TENANT, baseEvent),
    ).resolves.toBeUndefined();
    expect(instancesRepo.processSpendThresholdEvent).toHaveBeenCalled();
  });

  it('is best-effort: a definitions-lookup failure does not throw', async () => {
    const definitionsRepo = {
      findActiveByTriggerTypes: jest
        .fn()
        .mockRejectedValue(new Error('db down')),
    };
    const instancesRepo = { processPurchaseEvent: jest.fn() };
    const service = new RewardEligibilityService(
      definitionsRepo as any,
      instancesRepo as any,
    );
    await expect(
      service.onOrderCompleted(TENANT, baseEvent),
    ).resolves.toBeUndefined();
    expect(instancesRepo.processPurchaseEvent).not.toHaveBeenCalled();
  });

  it('is a no-op for a superadmin call with no tenantId', async () => {
    const { service, definitionsRepo } = build({});
    const superadmin = new TenantContext(undefined, undefined);
    await service.onOrderCompleted(superadmin, baseEvent);
    expect(definitionsRepo.findActiveByTriggerTypes).not.toHaveBeenCalled();
  });
});

describe('RewardEligibilityService.onLoyaltyPointsAwarded', () => {
  it('evaluates every active loyalty_points definition for the customer', async () => {
    const { service, instancesRepo, definitionsRepo } = build({
      definitions: [{ id: 'def-4' }, { id: 'def-5' }],
    });
    await service.onLoyaltyPointsAwarded(TENANT, 'cust-1', 'b1');
    expect(definitionsRepo.findActiveByTriggerType).toHaveBeenCalledWith(
      TENANT,
      'loyalty_points',
    );
    expect(instancesRepo.processLoyaltyPointsEvent).toHaveBeenCalledTimes(2);
    expect(instancesRepo.processLoyaltyPointsEvent).toHaveBeenNthCalledWith(
      1,
      't1',
      'cust-1',
      'def-4',
      'b1',
    );
  });

  it('is best-effort: a processing failure does not throw', async () => {
    const { service, instancesRepo } = build({
      definitions: [{ id: 'def-4' }],
    });
    instancesRepo.processLoyaltyPointsEvent.mockRejectedValueOnce(
      new Error('boom'),
    );
    await expect(
      service.onLoyaltyPointsAwarded(TENANT, 'cust-1', 'b1'),
    ).resolves.toBeUndefined();
  });

  it('is a no-op for a superadmin call with no tenantId', async () => {
    const { service, definitionsRepo } = build({});
    const superadmin = new TenantContext(undefined, undefined);
    await service.onLoyaltyPointsAwarded(superadmin, 'cust-1', 'b1');
    expect(definitionsRepo.findActiveByTriggerType).not.toHaveBeenCalled();
  });
});
