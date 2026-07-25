/**
 * Regression suite for item #9.1 (migration 120): purchase order approval
 * migrated onto the shared ApprovalEngine, plus the real enforcement gap
 * fix — a goods receipt can no longer be created against a PO that hasn't
 * been approved. Runs directly against the real shared Supabase project
 * (no isolated test DB in this environment), instantiating the actual
 * service/repository classes directly rather than booting the full Nest
 * app. Every fixture is tenant-scoped and torn down in afterAll. Not wired
 * into CI (api.yml only runs `npm run build`) — run deliberately via
 * `npm test`.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import { ApprovalEngine } from '../../../engines/approval-engine/approval.engine';
import { ApprovalHistoryRepository } from '../../../engines/approval-engine/approval-history.repository';
import { PurchaseOrdersRepository } from '../repositories/purchase-orders.repository';
import { PurchaseOrdersService } from '../purchase-orders.service';
import { GoodsReceiptsRepository } from '../repositories/goods-receipts.repository';
import { GoodsReceiptsService } from '../goods-receipts.service';
import { LocationsRepository } from '../../inventory/repositories/locations.repository';
import { LocationsService } from '../../inventory/locations.service';

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('purchase order approval engine + receipt gate (migration 120)', () => {
  let supabase: SupabaseClient;
  let poService: PurchaseOrdersService;
  let grService: GoodsReceiptsService;
  let warehouseId: string;
  let supplierId: string;
  let itemId: string;
  let userId: string;
  const cleanupPoIds: string[] = [];
  const cleanupGrIds: string[] = [];

  const createPo = async (orderNumber: string) => {
    const po = await poService.create(
      TEST_TENANT_ID,
      {
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        order_number: orderNumber,
        items: [{ item_id: itemId, quantity_ordered: 10, unit_cost: 5 }],
      },
      null,
    );
    cleanupPoIds.push(po.id);
    return po;
  };

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const approvalEngine = new ApprovalEngine();
    const approvalHistory = new ApprovalHistoryRepository(supabase);
    const poRepo = new PurchaseOrdersRepository(supabase);
    poService = new PurchaseOrdersService(
      poRepo,
      approvalEngine,
      approvalHistory,
    );
    const locRepo = new LocationsRepository(supabase);
    const locService = new LocationsService(locRepo, null);
    const grRepo = new GoodsReceiptsRepository(supabase);
    grService = new GoodsReceiptsService(grRepo, locService, poService);

    const { data: wh } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1);
    warehouseId = wh[0].id;
    const { data: u } = await supabase
      .from('users')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1);
    userId = u[0].id;

    const { data: supplier } = await supabase
      .from('suppliers')
      .insert({ tenant_id: TEST_TENANT_ID, name: 'Regression PO Supplier' })
      .select()
      .single();
    supplierId = supplier.id;

    const { data: item } = await supabase
      .from('items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name: 'Regression PO Item',
        type: 'product',
        operation_type: 'sell',
        price: 5,
        is_active: true,
      })
      .select()
      .single();
    itemId = item.id;
  }, 30_000);

  afterAll(async () => {
    for (const grId of cleanupGrIds) {
      await supabase
        .from('goods_receipt_items')
        .delete()
        .eq('goods_receipt_id', grId);
      await supabase.from('goods_receipts').delete().eq('id', grId);
    }
    await supabase.from('cost_layers').delete().eq('item_id', itemId);
    await supabase.from('stock_levels').delete().eq('item_id', itemId);
    for (const poId of cleanupPoIds) {
      await supabase
        .from('purchase_order_items')
        .delete()
        .eq('purchase_order_id', poId);
      await supabase.from('purchase_orders').delete().eq('id', poId);
    }
    await supabase.from('items').delete().eq('id', itemId);
    await supabase.from('suppliers').delete().eq('id', supplierId);
  }, 30_000);

  it('rejects a receipt against a draft (unapproved) PO', async () => {
    const po = await createPo(`REGR-91-DRAFT-${Date.now()}`);

    await expect(
      grService.create(TEST_TENANT_ID, {
        warehouse_id: warehouseId,
        purchase_order_id: po.id,
        receipt_number: `REGR-91-GR-${Date.now()}`,
        items: [
          {
            purchase_order_item_id: po.items[0].id,
            item_id: itemId,
            quantity_received: 5,
            unit_cost: 5,
          },
        ],
      } as any),
    ).rejects.toThrow(/must be approved first/);
  }, 30_000);

  it('approve via ApprovalEngine unblocks receiving', async () => {
    const po = await createPo(`REGR-91-FLOW-${Date.now()}`);
    await poService.submit(po.id, TEST_TENANT_ID);
    const approved = await poService.approve(po.id, TEST_TENANT_ID, userId);
    expect(approved.status).toBe('approved');
    expect(approved.approved_by).toBe(userId);

    const gr = await grService.create(TEST_TENANT_ID, {
      warehouse_id: warehouseId,
      purchase_order_id: po.id,
      receipt_number: `REGR-91-GR-OK-${Date.now()}`,
      items: [
        {
          purchase_order_item_id: po.items[0].id,
          item_id: itemId,
          quantity_received: 5,
          unit_cost: 5,
        },
      ],
    });
    cleanupGrIds.push(gr.id);
    expect(gr.id).toBeTruthy();
  }, 30_000);

  it('reject via ApprovalEngine records the reason and blocks receiving', async () => {
    const po = await createPo(`REGR-91-REJECT-${Date.now()}`);
    await poService.submit(po.id, TEST_TENANT_ID);
    const rejected = await poService.reject(po.id, TEST_TENANT_ID, userId, {
      reason: 'Price too high',
    });
    expect(rejected.status).toBe('rejected');
    expect(rejected.notes).toContain('Price too high');

    await expect(
      grService.create(TEST_TENANT_ID, {
        warehouse_id: warehouseId,
        purchase_order_id: po.id,
        receipt_number: `REGR-91-GR-REJ-${Date.now()}`,
        items: [
          {
            purchase_order_item_id: po.items[0].id,
            item_id: itemId,
            quantity_received: 5,
            unit_cost: 5,
          },
        ],
      } as any),
    ).rejects.toThrow(/must be approved first/);
  }, 30_000);

  it('cannot approve a rejected PO (ApprovalEngine.canApprove guard)', async () => {
    const po = await createPo(`REGR-91-NOAPPROVE-${Date.now()}`);
    await poService.submit(po.id, TEST_TENANT_ID);
    await poService.reject(po.id, TEST_TENANT_ID, userId, { reason: 'test' });

    await expect(
      poService.approve(po.id, TEST_TENANT_ID, userId),
    ).rejects.toThrow(/Cannot approve/);
  }, 30_000);

  it('rejects an empty rejection reason (ApprovalEngine.reject validation)', async () => {
    const po = await createPo(`REGR-91-EMPTYREASON-${Date.now()}`);
    await poService.submit(po.id, TEST_TENANT_ID);

    await expect(
      poService.reject(po.id, TEST_TENANT_ID, userId, { reason: '' } as any),
    ).rejects.toThrow(/Rejection reason is required/);
  }, 30_000);
});
