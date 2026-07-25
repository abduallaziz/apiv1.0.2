/**
 * Regression suite for item #9.2 (migration 121): Purchase Request module,
 * independent of purchase_orders, with approval driven entirely by the
 * shared ApprovalEngine and audited via the generic approval_history table.
 * Runs directly against the real shared Supabase project (no isolated test
 * DB in this environment), instantiating the actual service/repository
 * classes directly. Every fixture is tenant-scoped and torn down in
 * afterAll. Not wired into CI (api.yml only runs `npm run build`) — run
 * deliberately via `npm test`.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import { ApprovalEngine } from '../../../engines/approval-engine/approval.engine';
import { ApprovalHistoryRepository } from '../../../engines/approval-engine/approval-history.repository';
import { PurchaseRequestsRepository } from '../repositories/purchase-requests.repository';
import { PurchaseRequestsService } from '../purchase-requests.service';

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('purchase request module (migration 121)', () => {
  let supabase: SupabaseClient;
  let prService: PurchaseRequestsService;
  let warehouseId: string;
  let itemId: string;
  let userId: string;
  const cleanupPrIds: string[] = [];

  const createPr = async (requestNumber: string, quantity = 10) => {
    const pr = await prService.create(
      TEST_TENANT_ID,
      {
        warehouse_id: warehouseId,
        request_number: requestNumber,
        items: [{ item_id: itemId, quantity_requested: quantity }],
      },
      userId,
    );
    cleanupPrIds.push(pr.id);
    return pr;
  };

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const approvalEngine = new ApprovalEngine();
    const approvalHistory = new ApprovalHistoryRepository(supabase);
    const prRepo = new PurchaseRequestsRepository(supabase);
    prService = new PurchaseRequestsService(
      prRepo,
      approvalEngine,
      approvalHistory,
    );

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

    const { data: item } = await supabase
      .from('items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name: 'Regression PR Item',
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
    await supabase
      .from('approval_history')
      .delete()
      .eq('reference_type', 'purchase_request')
      .in('reference_id', cleanupPrIds);
    await supabase
      .from('purchase_request_items')
      .delete()
      .in('purchase_request_id', cleanupPrIds);
    await supabase.from('purchase_requests').delete().in('id', cleanupPrIds);
    await supabase.from('items').delete().eq('id', itemId);
  }, 30_000);

  it('creates a PR line with no pricing field at all', async () => {
    const pr = await createPr(`REGR-92-CREATE-${Date.now()}`);
    expect(pr.status).toBe('draft');
    expect(pr.items[0].unit_cost).toBeUndefined();
    expect(pr.items[0].estimated_unit_cost).toBeUndefined();
  }, 30_000);

  it('submit -> approve via ApprovalEngine records approval_history correctly', async () => {
    const pr = await createPr(`REGR-92-APPROVE-${Date.now()}`);
    await prService.submit(pr.id, TEST_TENANT_ID, userId);
    const approved = await prService.approve(pr.id, TEST_TENANT_ID, userId);
    expect(approved.status).toBe('approved');
    expect(approved.approved_by).toBe(userId);

    const history = await prService.history(pr.id, TEST_TENANT_ID);
    expect(history.map((h: any) => h.action)).toEqual([
      'submitted',
      'approved',
    ]);
    expect(history[1].previous_status).toBe('submitted');
    expect(history[1].new_status).toBe('approved');
  }, 30_000);

  it('cannot approve an already-approved PR (canApprove guard)', async () => {
    const pr = await createPr(`REGR-92-DOUBLEAPPROVE-${Date.now()}`);
    await prService.submit(pr.id, TEST_TENANT_ID, userId);
    await prService.approve(pr.id, TEST_TENANT_ID, userId);

    await expect(
      prService.approve(pr.id, TEST_TENANT_ID, userId),
    ).rejects.toThrow(/Cannot approve/);
  }, 30_000);

  it('reject via ApprovalEngine records the reason in notes and history', async () => {
    const pr = await createPr(`REGR-92-REJECT-${Date.now()}`);
    await prService.submit(pr.id, TEST_TENANT_ID, userId);
    const rejected = await prService.reject(pr.id, TEST_TENANT_ID, userId, {
      reason: 'Not needed',
    });
    expect(rejected.status).toBe('rejected');
    expect(rejected.notes).toContain('Not needed');

    const history = await prService.history(pr.id, TEST_TENANT_ID);
    expect(history.map((h: any) => h.action)).toEqual([
      'submitted',
      'rejected',
    ]);
  }, 30_000);

  it('cancel logs to approval_history too, not just approve/reject', async () => {
    const pr = await createPr(`REGR-92-CANCEL-${Date.now()}`);
    const cancelled = await prService.cancel(pr.id, TEST_TENANT_ID, userId);
    expect(cancelled.status).toBe('cancelled');

    const history = await prService.history(pr.id, TEST_TENANT_ID);
    expect(history.map((h: any) => h.action)).toEqual(['cancelled']);
  }, 30_000);

  it('is fully independent of purchase_orders — creating/approving a PR never touches PO, stock, or cost layers', async () => {
    // Scoped to this test's own item (not a tenant-wide count) — the tenant
    // is shared with other regression suites that may run concurrently and
    // create/delete their own real POs mid-test, which would make a
    // tenant-wide count assertion flaky without indicating any real bug.
    const pr = await createPr(`REGR-92-ISOLATION-${Date.now()}`);
    await prService.submit(pr.id, TEST_TENANT_ID, userId);
    await prService.approve(pr.id, TEST_TENANT_ID, userId);

    const { count: poItemCount } = await supabase
      .from('purchase_order_items')
      .select('*', { count: 'exact', head: true })
      .eq('item_id', itemId);
    const { count: movementCount } = await supabase
      .from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('item_id', itemId);
    const { count: layerCount } = await supabase
      .from('cost_layers')
      .select('*', { count: 'exact', head: true })
      .eq('item_id', itemId);

    expect(poItemCount).toBe(0);
    expect(movementCount).toBe(0);
    expect(layerCount).toBe(0);
  }, 30_000);
});
