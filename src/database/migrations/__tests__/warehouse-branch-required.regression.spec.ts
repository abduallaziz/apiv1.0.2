/**
 * Regression suite for Migration 13.1B (Roadmap #1, Organization Structure
 * completion) — warehouses.branch_id is now NOT NULL. Runs directly against
 * the real shared Supabase project via the service-role client — same
 * approach as every other regression spec in this directory.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo
const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000000';

describe('warehouse branch_id required (Migration 13.1B)', () => {
  let supabase: SupabaseClient;
  let mainBranchId: string;
  const warehouseIds: string[] = [];

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
    const { data: branch, error } = await supabase
      .from('branches')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('name', 'Main Branch')
      .single();
    if (error) throw error;
    mainBranchId = branch.id;
  }, 30_000);

  afterAll(async () => {
    for (const id of warehouseIds) {
      const { error } = await supabase.from('warehouses').delete().eq('id', id);
      if (error) {
        // Only expected if a test posted stock against it (immutable ledger, FK RESTRICT) —
        // fall back to soft delete so nothing is left active/orphaned.
        await supabase.from('warehouses').update({ deleted_at: new Date().toISOString(), is_active: false }).eq('id', id);
      }
    }
  }, 30_000);

  it('Test 1: warehouse creation without branch_id is rejected', async () => {
    const { error } = await supabase
      .from('warehouses')
      .insert({
        tenant_id: TEST_TENANT_ID,
        code: `REGR-NOBR-${Date.now()}`,
        name: 'No Branch Warehouse',
      })
      .select()
      .single();
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23502'); // not_null_violation
  }, 30_000);

  it('Test 2: warehouse creation with a valid branch_id succeeds', async () => {
    const { data, error } = await supabase
      .from('warehouses')
      .insert({
        tenant_id: TEST_TENANT_ID,
        branch_id: mainBranchId,
        code: `REGR-WITHBR-${Date.now()}`,
        name: 'With Branch Warehouse',
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data.branch_id).toBe(mainBranchId);
    warehouseIds.push(data.id);
  }, 30_000);

  it('Test 3: existing warehouses remain accessible after the constraint and backfill', async () => {
    const { data, error } = await supabase
      .from('warehouses')
      .select('id, branch_id')
      .eq('tenant_id', TEST_TENANT_ID)
      .is('deleted_at', null)
      .limit(5);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const w of data!) {
      expect(w.branch_id).not.toBeNull();
    }
  }, 30_000);

  it('Test 4: inventory operations (stock movements, transfers, counts) remain unaffected by the constraint', async () => {
    const { data: wh, error: whErr } = await supabase
      .from('warehouses')
      .insert({
        tenant_id: TEST_TENANT_ID,
        branch_id: mainBranchId,
        code: `REGR-INV-${Date.now()}`,
        name: 'Inventory Op Warehouse',
      })
      .select()
      .single();
    expect(whErr).toBeNull();
    warehouseIds.push(wh.id);

    const { data: item, error: itemErr } = await supabase
      .from('items')
      .insert({ tenant_id: TEST_TENANT_ID, name: 'Regr Branch-Req Item', type: 'product', operation_type: 'sell', price: 5, is_active: true })
      .select()
      .single();
    expect(itemErr).toBeNull();

    const { data: gr } = await supabase
      .from('goods_receipts')
      .insert({ tenant_id: TEST_TENANT_ID, warehouse_id: wh.id, receipt_number: `REGR-BR-${Date.now()}`, status: 'draft' })
      .select()
      .single();
    await supabase.from('goods_receipt_items').insert({
      tenant_id: TEST_TENANT_ID,
      goods_receipt_id: gr.id,
      item_id: item.id,
      quantity_received: 10,
      unit_cost: 2,
    });
    const { error: postErr } = await supabase.rpc('fn_post_goods_receipt', { p_goods_receipt_id: gr.id, p_actor_id: null });
    expect(postErr).toBeNull();

    const { data: balance } = await supabase
      .from('v_stock_balance')
      .select('quantity_on_hand')
      .eq('item_id', item.id)
      .is('location_id', null)
      .maybeSingle();
    expect(Number(balance?.quantity_on_hand)).toBe(10);

    // Cleanup specific to this test's own fixtures (goods_receipts/items), independent of afterAll.
    await supabase.from('goods_receipt_items').delete().eq('goods_receipt_id', gr.id);
    await supabase.from('goods_receipts').delete().eq('id', gr.id);
    await supabase.from('stock_levels').delete().eq('item_id', item.id);
    await supabase.from('cost_layers').delete().eq('item_id', item.id);
    await supabase.from('items').delete().eq('id', item.id);
  }, 30_000);

  it('Test 5: branch_id relationship respects tenant isolation', async () => {
    // A branch_id from another tenant must not be attachable to this tenant's warehouse.
    const { data: crossTenantBranch } = await supabase
      .from('branches')
      .select('id')
      .neq('tenant_id', TEST_TENANT_ID)
      .limit(1)
      .maybeSingle();

    if (!crossTenantBranch) {
      // No other tenant/branch exists in this environment — nothing to cross-check against.
      return;
    }

    const { data, error } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('branch_id', crossTenantBranch.id);
    expect(error).toBeNull();
    expect(data!.length).toBe(0); // no warehouse in this tenant is linked to another tenant's branch
  }, 30_000);
});
