import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { PosEngine } from '../../engines/pos-engine/pos.engine';
import { DiscountEngine } from '../../engines/discount-engine/discount.engine';
import { TenantContext } from '../../core/tenant/tenant-context';
import { PriceResolutionResult } from '../../core/pricing/price-resolution.service';
import { EffectiveRole } from '../../core/pricing/effective-role.resolver';

function buildService(overrides: {
  resolvePrice: jest.Mock;
  pooledWritesEnabled: boolean;
  require?: boolean;
  repoOverrides?: Partial<Record<string, jest.Mock>>;
}) {
  const repo = {
    findBySaleAttemptId: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'order-1' }),
    insertItems: jest.fn().mockResolvedValue(['oi-1', 'oi-2', 'oi-3']),
    createWithItemsPooled: jest.fn().mockResolvedValue({ id: 'order-1' }),
    getInvoiceNumberFormat: jest.fn().mockResolvedValue({ prefix: 'INV-', padding: 6 }),
    getBranchDefaultWarehouse: jest.fn().mockResolvedValue(null),
    // M184
    findById: jest
      .fn()
      .mockResolvedValue({ id: 'order-1', status: 'completed', total: 100 }),
    countReturns: jest.fn().mockResolvedValue(0),
    cancel: jest.fn().mockResolvedValue({ id: 'order-1', status: 'cancelled' }),
    cancelPooled: jest
      .fn()
      .mockResolvedValue({ id: 'order-1', status: 'cancelled' }),
    reverseSaleStockDeduction: jest.fn().mockResolvedValue(undefined),
    ...overrides.repoOverrides,
  };

  const config = {
    get: jest.fn((key: string) => {
      if (key === 'POOLED_INVOICE_WRITES_ENABLED')
        return overrides.pooledWritesEnabled;
      if (key === 'POOLED_LOYALTY_WRITES_ENABLED') return false;
      if (key === 'REQUIRE_POOLED_SALES') return overrides.require;
      return undefined;
    }),
  };

  const metrics = { recordInvoice: jest.fn(), recordUnpooledSaleAttempt: jest.fn() };
  const priceResolutionService = { resolvePrice: overrides.resolvePrice };

  const service = new InvoicesService(
    repo as any,
    new PosEngine(new DiscountEngine()),
    { processCashPayment: jest.fn() } as any, // paymentEngine
    { log: jest.fn().mockResolvedValue(undefined) } as any, // auditService
    metrics as any, // metricsService
    {
      getTaxRate: jest.fn().mockResolvedValue(0),
      getTaxConfig: jest
        .fn()
        .mockResolvedValue({ tax_rate: 0, tax_inclusive_pricing: false }),
    } as any, // tenantsRepo
    { getSettings: jest.fn().mockResolvedValue({ enabled: false }) } as any, // loyaltyService
    {} as any, // couponsService (unused — no coupon_code in these tests)
    { findById: jest.fn().mockResolvedValue(null) } as any, // customersService
    { notify: jest.fn().mockResolvedValue(undefined) } as any, // notificationService
    { delByPrefix: jest.fn().mockResolvedValue(undefined) } as any, // cache
    config as any,
    { assertOpenSession: jest.fn().mockResolvedValue(undefined) } as any, // shiftsService
    {} as any, // holdsRepo (unused — warehouseId null short-circuits the stock block)
    {} as any, // ownershipRepo
    {} as any, // expiredBatchesRepo
    { findSoldByOrder: jest.fn().mockResolvedValue([]) } as any, // serialsRepo
    priceResolutionService as any,
    { onOrderCompleted: jest.fn().mockResolvedValue(undefined) } as any, // rewardEligibilityService
    {
      previewSelection: jest.fn(),
      redeemSelected: jest.fn(),
      attachOrder: jest.fn().mockResolvedValue(undefined),
    } as any, // rewardRedemptionService
    {} as any, // packagingLevelsRepo (unused — no packaging_level_id in these tests)
    { enabled: false } as any, // zatca
  );

  return { service, repo, metrics };
}

const TENANT = new TenantContext('t1', 'b1');

describe('R-UNPOOLED sale-path guard', () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });
  const dto = () => ({
    branch_id: 'b1',
    sale_attempt_id: 'attempt-1',
    items: [{ item_id: 'i1', item_name: 'W', quantity: 1, unit_price: 100 }],
    payment_method: 'cash' as const,
    cash_tendered: 1000,
  });
  const run = (service: InvoicesService) =>
    service.create(TENANT, dto(), 'u1', 'cashier', 'b1', 'shift-1', '1.2.3.4', 'device');
  const noOverride = () =>
    jest.fn().mockResolvedValue({ kind: 'no_override', officialUnitPrice: 100 });

  it('production, unpooled, REQUIRE unset: sale still saved (unchanged), flagged in metric', async () => {
    process.env.NODE_ENV = 'production';
    const { service, repo, metrics } = buildService({ resolvePrice: noOverride(), pooledWritesEnabled: false });
    jest.spyOn((service as any).logger, 'error').mockImplementation();
    await expect(run(service)).resolves.toBeDefined();
    expect(repo.create).toHaveBeenCalled();
    expect(metrics.recordUnpooledSaleAttempt).toHaveBeenCalledWith('flagged');
  });

  it('production, unpooled, REQUIRE=true: refused before any write', async () => {
    process.env.NODE_ENV = 'production';
    const { service, repo, metrics } = buildService({ resolvePrice: noOverride(), pooledWritesEnabled: false, require: true });
    jest.spyOn((service as any).logger, 'error').mockImplementation();
    await expect(run(service)).rejects.toMatchObject({ response: { reasonCode: 'pooled_sales_required' } });
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.createWithItemsPooled).not.toHaveBeenCalled();
    expect(metrics.recordUnpooledSaleAttempt).toHaveBeenCalledWith('refused');
  });

  it('production, pooled, REQUIRE=true: normal pooled sale', async () => {
    process.env.NODE_ENV = 'production';
    const { service, repo, metrics } = buildService({ resolvePrice: noOverride(), pooledWritesEnabled: true, require: true });
    await expect(run(service)).resolves.toBeDefined();
    expect(repo.createWithItemsPooled).toHaveBeenCalled();
    expect(metrics.recordUnpooledSaleAttempt).not.toHaveBeenCalled();
  });

  it('non-production, unpooled, REQUIRE=true: unchanged (dev/test keep working)', async () => {
    process.env.NODE_ENV = 'test';
    const { service, repo, metrics } = buildService({ resolvePrice: noOverride(), pooledWritesEnabled: false, require: true });
    await expect(run(service)).resolves.toBeDefined();
    expect(repo.create).toHaveBeenCalled();
    expect(metrics.recordUnpooledSaleAttempt).not.toHaveBeenCalled();
  });
});
