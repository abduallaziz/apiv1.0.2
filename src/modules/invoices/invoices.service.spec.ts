import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { PosEngine } from '../../engines/pos-engine/pos.engine';
import { DiscountEngine } from '../../engines/discount-engine/discount.engine';
import { TenantContext } from '../../core/tenant/tenant-context';
import { PriceResolutionResult } from '../../core/pricing/price-resolution.service';
import { EffectiveRole } from '../../core/pricing/effective-role.resolver';

// D01-M7 — InvoicesService.create() integration tests. InvoicesService has
// a large dependency surface (payment/loyalty/coupon/stock/notifications/
// etc.) unrelated to D01; every one of those is faked with the minimal
// surface needed to reach a successful "completed" invoice, so these tests
// can focus purely on Price Resolution integration behavior — the write
// path (repo.create / insertItems / createWithItemsPooled) is asserted via
// jest.fn() call inspection rather than a real DB.
function buildService(overrides: {
  resolvePrice: jest.Mock;
  pooledWritesEnabled: boolean;
  repoOverrides?: Partial<Record<string, jest.Mock>>;
}) {
  const repo = {
    findBySaleAttemptId: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'order-1' }),
    insertItems: jest.fn().mockResolvedValue(['oi-1', 'oi-2', 'oi-3']),
    createWithItemsPooled: jest.fn().mockResolvedValue({ id: 'order-1' }),
    getBranchDefaultWarehouse: jest.fn().mockResolvedValue(null),
    // M184
    findById: jest
      .fn()
      .mockResolvedValue({ id: 'order-1', status: 'completed', total: 100 }),
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
      return undefined;
    }),
  };

  const priceResolutionService = { resolvePrice: overrides.resolvePrice };

  const service = new InvoicesService(
    repo as any,
    new PosEngine(new DiscountEngine()),
    { processCashPayment: jest.fn() } as any, // paymentEngine
    { log: jest.fn().mockResolvedValue(undefined) } as any, // auditService
    { recordInvoice: jest.fn() } as any, // metricsService
    { getTaxRate: jest.fn().mockResolvedValue(0) } as any, // tenantsRepo
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
  );

  return { service, repo, priceResolutionService };
}

const TENANT = new TenantContext('t1', 'b1');

function baseDto(items: any[]) {
  return {
    branch_id: 'b1',
    sale_attempt_id: 'attempt-1',
    items,
    payment_method: 'cash' as const,
    cash_tendered: 1000,
  };
}

const OWNER_ROLE: EffectiveRole = {
  roleId: 'r-owner',
  roleName: 'owner',
  priority: 90,
};

describe('InvoicesService.create — D01-M7 Price Resolution integration', () => {
  describe('Normal Sale', () => {
    it('single item, no_override -> non-pooled write, official price used, no role/policy involvement', async () => {
      const resolvePrice = jest.fn().mockResolvedValue({
        kind: 'no_override',
        officialUnitPrice: 100,
      });
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: false,
      });

      const dto = baseDto([
        {
          item_id: 'item-1',
          item_name: 'Widget',
          quantity: 1,
          unit_price: 100,
        },
      ]);

      const result = await service.create(
        TENANT,
        dto,
        'user-1',
        'cashier',
        'b1',
        'shift-1',
        '1.2.3.4',
        'device',
      );

      expect(result.id).toBe('order-1');
      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(repo.insertItems).toHaveBeenCalledTimes(1);
      expect(repo.createWithItemsPooled).not.toHaveBeenCalled();

      const insertedItems = repo.insertItems.mock.calls[0][0];
      expect(insertedItems[0].unit_price).toBe(100);
      expect(insertedItems[0].official_price_snapshot).toBe(100);
    });

    it('multi-item, all no_override -> subtotal/discount/tax unchanged, existing behavior preserved', async () => {
      const resolvePrice = jest
        .fn()
        .mockResolvedValueOnce({ kind: 'no_override', officialUnitPrice: 50 })
        .mockResolvedValueOnce({ kind: 'no_override', officialUnitPrice: 30 });
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: false,
      });

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'A', quantity: 2, unit_price: 50 },
        { item_id: 'item-2', item_name: 'B', quantity: 1, unit_price: 30 },
      ]);

      const result = await service.create(
        TENANT,
        dto,
        'user-1',
        'cashier',
        'b1',
        'shift-1',
        '1.2.3.4',
        'device',
      );

      expect(result.total).toBe(130); // 2*50 + 1*30, no tax (taxRate=0), no discount
      expect(repo.insertItems).toHaveBeenCalledTimes(1);
      expect(repo.insertItems.mock.calls[0][0]).toHaveLength(2);
    });
  });

  describe('Override — approved', () => {
    it('approved discount, pooled enabled -> pooled write with official_price_snapshot + audit payload', async () => {
      const resolvePrice = jest.fn().mockResolvedValue({
        kind: 'approved',
        officialUnitPrice: 100,
        approvedUnitPrice: 80,
        differenceAmount: 20,
        differencePercent: 20,
        direction: 'discount',
        reason: 'manager approval',
        effectiveRole: OWNER_ROLE,
        effectivePolicySnapshot: { allow_discount: true },
      });
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'Widget', quantity: 1, unit_price: 80 },
      ]);

      const result = await service.create(
        TENANT,
        dto,
        'user-1',
        'cashier',
        'b1',
        'shift-1',
        '1.2.3.4',
        'device',
      );

      expect(result.id).toBe('order-1');
      expect(repo.createWithItemsPooled).toHaveBeenCalledTimes(1);
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.insertItems).not.toHaveBeenCalled();

      const [, , pooledItems] = repo.createWithItemsPooled.mock.calls[0];
      expect(pooledItems[0].unit_price).toBe(80);
      expect(pooledItems[0].official_price_snapshot).toBe(100);
      expect(pooledItems[0].override).toEqual({
        actor_role_id: 'r-owner',
        actor_role_name_snapshot: 'owner',
        official_unit_price: 100,
        approved_unit_price: 80,
        difference_amount: 20,
        difference_percent: 20,
        direction: 'discount',
        reason: 'manager approval',
        effective_policy_snapshot: { allow_discount: true },
      });
    });

    it('approved override, pooled disabled -> rejected before any write, reasonCode price_override_requires_atomic_write_path', async () => {
      const resolvePrice = jest.fn().mockResolvedValue({
        kind: 'approved',
        officialUnitPrice: 100,
        approvedUnitPrice: 80,
        differenceAmount: 20,
        differencePercent: 20,
        direction: 'discount',
        reason: null,
        effectiveRole: OWNER_ROLE,
        effectivePolicySnapshot: {},
      });
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: false,
      });

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'Widget', quantity: 1, unit_price: 80 },
      ]);

      await expect(
        service.create(
          TENANT,
          dto as any,
          'user-1',
          'cashier',
          'b1',
          'shift-1',
          '1.2.3.4',
          'device',
        ),
      ).rejects.toMatchObject({
        response: { reasonCode: 'price_override_requires_atomic_write_path' },
      });

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.insertItems).not.toHaveBeenCalled();
      expect(repo.createWithItemsPooled).not.toHaveBeenCalled();
    });

    it('Effective Role resolved once, reused for every override line in the same invoice', async () => {
      const resolvePrice = jest.fn().mockImplementation((input) => {
        // First call receives no pre-resolved role (undefined); every
        // subsequent call must receive the cached role from the first
        // approved result.
        if (resolvePrice.mock.calls.length === 1) {
          expect(input.effectiveRole).toBeUndefined();
        } else {
          expect(input.effectiveRole).toEqual(OWNER_ROLE);
        }
        return Promise.resolve({
          kind: 'approved',
          officialUnitPrice: 100,
          approvedUnitPrice: 80,
          differenceAmount: 20,
          differencePercent: 20,
          direction: 'discount',
          reason: null,
          effectiveRole: OWNER_ROLE,
          effectivePolicySnapshot: {},
        } as PriceResolutionResult);
      });
      const { service } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'A', quantity: 1, unit_price: 80 },
        { item_id: 'item-2', item_name: 'B', quantity: 1, unit_price: 80 },
        { item_id: 'item-3', item_name: 'C', quantity: 1, unit_price: 80 },
      ]);

      await service.create(
        TENANT,
        dto,
        'user-1',
        'cashier',
        'b1',
        'shift-1',
        '1.2.3.4',
        'device',
      );

      expect(resolvePrice).toHaveBeenCalledTimes(3);
    });
  });

  describe('Override — rejected', () => {
    it('permission denied -> BadRequestException, zero writes', async () => {
      const resolvePrice = jest.fn().mockResolvedValue({
        kind: 'rejected',
        officialUnitPrice: 100,
        requestedUnitPrice: 80,
        reasonCode: 'permission_denied',
        resolvedEffectiveRole: OWNER_ROLE,
      });
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'Widget', quantity: 1, unit_price: 80 },
      ]);

      await expect(
        service.create(
          TENANT,
          dto as any,
          'user-1',
          'cashier',
          'b1',
          'shift-1',
          '1.2.3.4',
          'device',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.createWithItemsPooled).not.toHaveBeenCalled();
    });

    it('policy limit exceeded -> BadRequestException, zero writes', async () => {
      const resolvePrice = jest.fn().mockResolvedValue({
        kind: 'rejected',
        officialUnitPrice: 100,
        requestedUnitPrice: 10,
        reasonCode: 'limit_exceeded',
        resolvedEffectiveRole: OWNER_ROLE,
      });
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'Widget', quantity: 1, unit_price: 10 },
      ]);

      await expect(
        service.create(
          TENANT,
          dto as any,
          'user-1',
          'cashier',
          'b1',
          'shift-1',
          '1.2.3.4',
          'device',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('item_or_variant_not_found -> NotFoundException, zero writes', async () => {
      const resolvePrice = jest.fn().mockResolvedValue({
        kind: 'rejected',
        officialUnitPrice: 0,
        requestedUnitPrice: 80,
        reasonCode: 'item_or_variant_not_found',
      });
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });

      const dto = baseDto([
        {
          item_id: 'missing-item',
          item_name: 'Ghost',
          quantity: 1,
          unit_price: 80,
        },
      ]);

      await expect(
        service.create(
          TENANT,
          dto as any,
          'user-1',
          'cashier',
          'b1',
          'shift-1',
          '1.2.3.4',
          'device',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.createWithItemsPooled).not.toHaveBeenCalled();
    });

    it('official=0 -> positive requested -> rejected, zero writes', async () => {
      const resolvePrice = jest.fn().mockResolvedValue({
        kind: 'rejected',
        officialUnitPrice: 0,
        requestedUnitPrice: 5,
        reasonCode: 'official_price_zero_increase_not_supported',
      });
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'Freebie', quantity: 1, unit_price: 5 },
      ]);

      await expect(
        service.create(
          TENANT,
          dto as any,
          'user-1',
          'cashier',
          'b1',
          'shift-1',
          '1.2.3.4',
          'device',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('Multi-item atomicity', () => {
    it('Item 1 approved, Item 2 approved, Item 3 rejected -> zero writes at all', async () => {
      const resolvePrice = jest
        .fn()
        .mockResolvedValueOnce({
          kind: 'approved',
          officialUnitPrice: 100,
          approvedUnitPrice: 80,
          differenceAmount: 20,
          differencePercent: 20,
          direction: 'discount',
          reason: null,
          effectiveRole: OWNER_ROLE,
          effectivePolicySnapshot: {},
        })
        .mockResolvedValueOnce({
          kind: 'approved',
          officialUnitPrice: 50,
          approvedUnitPrice: 40,
          differenceAmount: 10,
          differencePercent: 20,
          direction: 'discount',
          reason: null,
          effectiveRole: OWNER_ROLE,
          effectivePolicySnapshot: {},
        })
        .mockResolvedValueOnce({
          kind: 'rejected',
          officialUnitPrice: 30,
          requestedUnitPrice: 5,
          reasonCode: 'limit_exceeded',
          resolvedEffectiveRole: OWNER_ROLE,
        });
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'A', quantity: 1, unit_price: 80 },
        { item_id: 'item-2', item_name: 'B', quantity: 1, unit_price: 40 },
        { item_id: 'item-3', item_name: 'C', quantity: 1, unit_price: 5 },
      ]);

      await expect(
        service.create(
          TENANT,
          dto as any,
          'user-1',
          'cashier',
          'b1',
          'shift-1',
          '1.2.3.4',
          'device',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.insertItems).not.toHaveBeenCalled();
      expect(repo.createWithItemsPooled).not.toHaveBeenCalled();
      // Only the first 3 resolutions run (no 4th line) — confirms no
      // resolution happens "again" after the rejection, and nothing after
      // the loop (buildInvoice/order write) ever executes.
      expect(resolvePrice).toHaveBeenCalledTimes(3);
    });

    it('all approved, multiple overrides -> single pooled call with all lines', async () => {
      const resolvePrice = jest.fn().mockImplementation(() =>
        Promise.resolve({
          kind: 'approved',
          officialUnitPrice: 100,
          approvedUnitPrice: 90,
          differenceAmount: 10,
          differencePercent: 10,
          direction: 'discount',
          reason: null,
          effectiveRole: OWNER_ROLE,
          effectivePolicySnapshot: {},
        } as PriceResolutionResult),
      );
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'A', quantity: 1, unit_price: 90 },
        { item_id: 'item-2', item_name: 'B', quantity: 1, unit_price: 90 },
      ]);

      await service.create(
        TENANT,
        dto,
        'user-1',
        'cashier',
        'b1',
        'shift-1',
        '1.2.3.4',
        'device',
      );

      expect(repo.createWithItemsPooled).toHaveBeenCalledTimes(1);
      const [, , pooledItems] = repo.createWithItemsPooled.mock.calls[0];
      expect(pooledItems).toHaveLength(2);
      expect(pooledItems.every((i: any) => i.override)).toBe(true);
    });

    it('mix override + normal items -> only the override line carries an audit payload', async () => {
      const resolvePrice = jest
        .fn()
        .mockResolvedValueOnce({ kind: 'no_override', officialUnitPrice: 50 })
        .mockResolvedValueOnce({
          kind: 'approved',
          officialUnitPrice: 100,
          approvedUnitPrice: 80,
          differenceAmount: 20,
          differencePercent: 20,
          direction: 'discount',
          reason: null,
          effectiveRole: OWNER_ROLE,
          effectivePolicySnapshot: {},
        });
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'Normal', quantity: 1, unit_price: 50 },
        {
          item_id: 'item-2',
          item_name: 'Overridden',
          quantity: 1,
          unit_price: 80,
        },
      ]);

      await service.create(
        TENANT,
        dto,
        'user-1',
        'cashier',
        'b1',
        'shift-1',
        '1.2.3.4',
        'device',
      );

      const [, , pooledItems] = repo.createWithItemsPooled.mock.calls[0];
      expect(pooledItems[0].override).toBeUndefined();
      expect(pooledItems[0].official_price_snapshot).toBe(50);
      expect(pooledItems[1].override).toBeDefined();
      expect(pooledItems[1].official_price_snapshot).toBe(100);
    });
  });

  describe('Retry', () => {
    it('duplicate sale_attempt_id -> ConflictException before any Price Resolution call', async () => {
      const resolvePrice = jest.fn();
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });
      repo.findBySaleAttemptId.mockResolvedValue({ id: 'existing-order' });

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'A', quantity: 1, unit_price: 80 },
      ]);

      await expect(
        service.create(
          TENANT,
          dto as any,
          'user-1',
          'cashier',
          'b1',
          'shift-1',
          '1.2.3.4',
          'device',
        ),
      ).rejects.toMatchObject({ response: { order_id: 'existing-order' } });

      expect(resolvePrice).not.toHaveBeenCalled();
    });
  });

  describe('M184 — Sales Posting integration', () => {
    it('pooled write path: posting is delegated to createWithItemsPooled (accounting posting lives inside that same transaction)', async () => {
      const resolvePrice = jest.fn().mockResolvedValue({
        kind: 'no_override',
        officialUnitPrice: 100,
      });
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'A', quantity: 1, unit_price: 100 },
      ]);
      await service.create(
        TENANT,
        dto,
        'user-1',
        'cashier',
        'b1',
        'shift-1',
        '1.2.3.4',
        'device',
      );

      // The repository method itself is responsible for calling
      // fn_post_sales_order() inside its own transaction — verified at
      // the repository/SQL level (see the M184 migration + live
      // validation), not re-mocked here since it's not a separate call
      // from the service's point of view.
      expect(repo.createWithItemsPooled).toHaveBeenCalledTimes(1);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('accounting posting failure (surfaced as a plain Postgres error from the pooled transaction) maps to BadRequestException with reasonCode', async () => {
      const resolvePrice = jest.fn().mockResolvedValue({
        kind: 'no_override',
        officialUnitPrice: 100,
      });
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });
      repo.createWithItemsPooled.mockRejectedValue(
        new Error(
          'No Accounting Owner is assigned to branch b1 on date 2026-08-13 (order o1)',
        ),
      );

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'A', quantity: 1, unit_price: 100 },
      ]);

      await expect(
        service.create(
          TENANT,
          dto as any,
          'user-1',
          'cashier',
          'b1',
          'shift-1',
          '1.2.3.4',
          'device',
        ),
      ).rejects.toMatchObject({
        response: { reasonCode: 'accounting_posting_failed' },
      });
    });

    it('closed fiscal period failure also maps to accounting_posting_failed', async () => {
      const resolvePrice = jest.fn().mockResolvedValue({
        kind: 'no_override',
        officialUnitPrice: 100,
      });
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });
      repo.createWithItemsPooled.mockRejectedValue(
        new Error(
          'Fiscal period p1 (status=closed) is not open — journal entry e1 cannot be posted',
        ),
      );

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'A', quantity: 1, unit_price: 100 },
      ]);

      await expect(
        service.create(
          TENANT,
          dto as any,
          'user-1',
          'cashier',
          'b1',
          'shift-1',
          '1.2.3.4',
          'device',
        ),
      ).rejects.toMatchObject({
        response: { reasonCode: 'accounting_posting_failed' },
      });
    });

    it('unrelated errors (e.g. a generic DB error) are NOT reshaped into accounting_posting_failed', async () => {
      const resolvePrice = jest.fn().mockResolvedValue({
        kind: 'no_override',
        officialUnitPrice: 100,
      });
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });
      repo.createWithItemsPooled.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'A', quantity: 1, unit_price: 100 },
      ]);

      await expect(
        service.create(
          TENANT,
          dto as any,
          'user-1',
          'cashier',
          'b1',
          'shift-1',
          '1.2.3.4',
          'device',
        ),
      ).rejects.toThrow('connection terminated unexpectedly');
    });

    it('non-pooled write path never attempts accounting posting (no createWithItemsPooled/cancelPooled call)', async () => {
      const resolvePrice = jest.fn().mockResolvedValue({
        kind: 'no_override',
        officialUnitPrice: 100,
      });
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: false,
      });

      const dto = baseDto([
        { item_id: 'item-1', item_name: 'A', quantity: 1, unit_price: 100 },
      ]);
      await service.create(
        TENANT,
        dto,
        'user-1',
        'cashier',
        'b1',
        'shift-1',
        '1.2.3.4',
        'device',
      );

      expect(repo.createWithItemsPooled).not.toHaveBeenCalled();
      expect(repo.cancelPooled).not.toHaveBeenCalled();
    });
  });

  describe('M184 — cancel() reversal integration', () => {
    it('pooled: cancel() uses cancelPooled() (atomic status change + reversal)', async () => {
      const resolvePrice = jest.fn();
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });

      await service.cancel(
        TENANT,
        'order-1',
        { reason: 'test' },
        'user-1',
        'owner',
        '1.2.3.4',
        'device',
      );

      expect(repo.cancelPooled).toHaveBeenCalledWith(
        TENANT,
        'order-1',
        'user-1',
      );
      expect(repo.cancel).not.toHaveBeenCalled();
    });

    it('non-pooled: cancel() uses the plain cancel() path, never attempts reversal', async () => {
      const resolvePrice = jest.fn();
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: false,
      });

      await service.cancel(
        TENANT,
        'order-1',
        { reason: 'test' },
        'user-1',
        'owner',
        '1.2.3.4',
        'device',
      );

      expect(repo.cancel).toHaveBeenCalledWith(TENANT, 'order-1', 'user-1');
      expect(repo.cancelPooled).not.toHaveBeenCalled();
    });

    it('already-cancelled order is rejected before any repo write', async () => {
      const resolvePrice = jest.fn();
      const { service, repo } = buildService({
        resolvePrice,
        pooledWritesEnabled: true,
      });
      repo.findById.mockResolvedValue({
        id: 'order-1',
        status: 'cancelled',
        total: 100,
      });

      await expect(
        service.cancel(
          TENANT,
          'order-1',
          { reason: 'test' } as any,
          'user-1',
          'owner',
          '1.2.3.4',
          'device',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.cancelPooled).not.toHaveBeenCalled();
      expect(repo.cancel).not.toHaveBeenCalled();
    });
  });
});
