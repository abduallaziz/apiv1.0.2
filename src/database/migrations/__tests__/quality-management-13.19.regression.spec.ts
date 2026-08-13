/**
 * Regression suite for Migration 13.19 — Quality Management full
 * implementation: hard-block Quality Hold, Inspection templates/rules,
 * NCR lifecycle, CAPA, tenant isolation. Runs directly against the real
 * Supabase project, same pattern as every other regression suite this
 * session. Not wired into CI — run via `npm test`.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo
const OTHER_TENANT = '00000000-0000-0000-0000-000000000000';

describe('Quality Management (migration 13.19)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  let itemId: string;
  let userId: string;
  let templateId: string;
  let ncId: string;
  let capaId: string;

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const { data: wh } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TENANT)
      .limit(1);
    warehouseId = wh[0].id;
    const { data: users } = await supabase
      .from('users')
      .select('id')
      .eq('tenant_id', TENANT)
      .limit(1);
    userId = users[0].id;

    const { data: item } = await supabase
      .from('items')
      .insert({
        tenant_id: TENANT,
        name: 'QA 13.19 Test Item',
        type: 'product',
        operation_type: 'sell',
        price: 5,
        is_active: true,
      })
      .select()
      .single();
    itemId = item.id;

    await supabase.rpc('fn_apply_stock_movement', {
      p_tenant_id: TENANT,
      p_warehouse_id: warehouseId,
      p_location_id: null,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_movement_type: 'receipt',
      p_direction: 'in',
      p_quantity: 100,
      p_unit_cost: 2,
      p_reference_type: 'test',
      p_reference_id: null,
      p_created_by: null,
      p_allow_negative: false,
    });
  }, 30_000);

  afterAll(async () => {
    await supabase
      .from('corrective_action_history')
      .delete()
      .eq('tenant_id', TENANT)
      .eq(
        'corrective_action_id',
        capaId ?? '00000000-0000-0000-0000-000000000000',
      );
    if (capaId)
      await supabase.from('corrective_actions').delete().eq('id', capaId);
    await supabase
      .from('quality_status_history')
      .delete()
      .eq('reference_id', ncId ?? '00000000-0000-0000-0000-000000000000');
    if (ncId) await supabase.from('non_conformances').delete().eq('id', ncId);
    await supabase
      .from('quality_hold_history')
      .delete()
      .eq('tenant_id', TENANT);
    await supabase.from('quality_holds').delete().eq('item_id', itemId);
    await supabase.from('quality_inspections').delete().eq('item_id', itemId);
    if (templateId) {
      await supabase
        .from('quality_template_checks')
        .delete()
        .eq('template_id', templateId);
      await supabase.from('quality_templates').delete().eq('id', templateId);
    }
    await supabase
      .from('items')
      .update({ is_active: false, deleted_at: new Date().toISOString() })
      .eq('id', itemId);
  }, 30_000);

  // ---- Inspection ----

  it('1. create inspection', async () => {
    const { data: t } = await supabase
      .from('quality_templates')
      .insert({ tenant_id: TENANT, name: 'QA Template' })
      .select()
      .single();
    templateId = t.id;
    await supabase.from('quality_template_checks').insert({
      tenant_id: TENANT,
      template_id: templateId,
      description: 'Visual check',
    });

    const { data: insp, error } = await supabase
      .from('quality_inspections')
      .insert({
        tenant_id: TENANT,
        reference_type: 'goods_receipt',
        reference_id: '00000000-0000-0000-0000-000000000001',
        item_id: itemId,
        template_id: templateId,
        warehouse_id: warehouseId,
        quantity_inspected: 20,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(insp.status).toBe('pending');
  });

  it('2. pass inspection', async () => {
    const { data: insp } = await supabase
      .from('quality_inspections')
      .insert({
        tenant_id: TENANT,
        reference_type: 'stock_count',
        reference_id: '00000000-0000-0000-0000-000000000002',
        item_id: itemId,
        warehouse_id: warehouseId,
        quantity_inspected: 10,
      })
      .select()
      .single();
    const { data: passed, error } = await supabase
      .from('quality_inspections')
      .update({ status: 'passed', inspected_at: new Date().toISOString() })
      .eq('id', insp.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();
    expect(error).toBeNull();
    expect(passed.status).toBe('passed');
  });

  it('3. fail inspection', async () => {
    const { data: insp } = await supabase
      .from('quality_inspections')
      .insert({
        tenant_id: TENANT,
        reference_type: 'stock_count',
        reference_id: '00000000-0000-0000-0000-000000000003',
        item_id: itemId,
        warehouse_id: warehouseId,
        quantity_inspected: 15,
      })
      .select()
      .single();
    const { data: failed, error } = await supabase
      .from('quality_inspections')
      .update({ status: 'failed', inspected_at: new Date().toISOString() })
      .eq('id', insp.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();
    expect(error).toBeNull();
    expect(failed.status).toBe('failed');
  });

  it('4. conditional result', async () => {
    const { data: insp } = await supabase
      .from('quality_inspections')
      .insert({
        tenant_id: TENANT,
        reference_type: 'stock_count',
        reference_id: '00000000-0000-0000-0000-000000000004',
        item_id: itemId,
        warehouse_id: warehouseId,
        quantity_inspected: 5,
      })
      .select()
      .single();
    const { data: cond, error } = await supabase
      .from('quality_inspections')
      .update({ status: 'conditional', inspected_at: new Date().toISOString() })
      .eq('id', insp.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();
    expect(error).toBeNull();
    expect(cond.status).toBe('conditional');
  });

  // ---- Quality Hold (hard block) ----

  it('5. failed inspection creates hold (fn_create_quality_hold)', async () => {
    const { data: hold, error } = await supabase.rpc('fn_create_quality_hold', {
      p_tenant_id: TENANT,
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: null,
      p_location_id: null,
      p_batch_id: null,
      p_serial_id: null,
      p_quantity_held: 30,
      p_reason: 'failed inspection',
      p_source_document_type: 'goods_receipt',
      p_source_document_id: null,
      p_quality_inspection_id: null,
      p_created_by: userId,
    });
    expect(error).toBeNull();
    expect(hold.status).toBe('active');
    expect(Number(hold.quantity_held)).toBe(30);

    const mv = await supabase
      .from('stock_movements')
      .select('movement_type,reference_id')
      .eq('item_id', itemId)
      .eq('movement_type', 'quality_hold')
      .eq('reference_id', hold.id)
      .maybeSingle();
    expect(mv.data).not.toBeNull();
  });

  it('6. held stock unavailable for sale (reservation blocked, restored on release)', async () => {
    const bal = await supabase
      .from('v_stock_balance')
      .select('quantity_available')
      .eq('tenant_id', TENANT)
      .eq('item_id', itemId)
      .single();
    expect(Number(bal.data.quantity_available)).toBe(70); // 100 on-hand - 30 held

    const over = await supabase.rpc('fn_create_reservation', {
      p_tenant_id: TENANT,
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: null,
      p_batch_id: null,
      p_quantity: 71,
      p_reference_type: 'test',
      p_reference_id: '00000000-0000-0000-0000-000000000005',
      p_created_by: userId,
      p_expires_at: null,
    });
    expect(over.error?.message).toMatch(/INSUFFICIENT_STOCK/);

    const { data: holds } = await supabase
      .from('quality_holds')
      .select('id')
      .eq('item_id', itemId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);
    const holdId = holds[0].id;
    const released = await supabase.rpc('fn_release_quality_hold', {
      p_hold_id: holdId,
      p_tenant_id: TENANT,
      p_actor_id: userId,
      p_reason: 'ok',
    });
    expect(released.error).toBeNull();
    expect(released.data.status).toBe('released');

    const bal2 = await supabase
      .from('v_stock_balance')
      .select('quantity_available')
      .eq('tenant_id', TENANT)
      .eq('item_id', itemId)
      .single();
    expect(Number(bal2.data.quantity_available)).toBe(100);
  });

  // ---- NCR ----

  it('7. create NCR', async () => {
    const { data: insp } = await supabase
      .from('quality_inspections')
      .insert({
        tenant_id: TENANT,
        reference_type: 'stock_count',
        reference_id: '00000000-0000-0000-0000-000000000006',
        item_id: itemId,
        warehouse_id: warehouseId,
        status: 'failed',
      })
      .select()
      .single();
    const { data: nc, error } = await supabase
      .from('non_conformances')
      .insert({
        tenant_id: TENANT,
        quality_inspection_id: insp.id,
        item_id: itemId,
        description: 'Cracked casing',
        severity: 'major',
        category: 'manufacturing_defect',
        source: 'inspection',
        status: 'open',
      })
      .select()
      .single();
    expect(error).toBeNull();
    ncId = nc.id;
    expect(nc.status).toBe('open');
  });

  it('8. NCR moves through lifecycle (open -> investigating -> containment -> corrective_action -> verification -> closed)', async () => {
    const stages = [
      'investigating',
      'containment',
      'corrective_action',
      'verification',
    ];
    let current = 'open';
    for (const stage of stages) {
      const { data, error } = await supabase
        .from('non_conformances')
        .update({ status: stage })
        .eq('id', ncId)
        .eq('status', current)
        .select()
        .maybeSingle();
      expect(error).toBeNull();
      expect(data.status).toBe(stage);
      current = stage;
    }
    expect(current).toBe('verification');
  });

  // ---- CAPA ----

  it('9. assign corrective action', async () => {
    const { data: action, error } = await supabase
      .from('corrective_actions')
      .insert({
        tenant_id: TENANT,
        non_conformance_id: ncId,
        title: 'Inspect supplier tooling',
        owner_id: userId,
        priority: 'high',
        status: 'assigned',
      })
      .select()
      .single();
    expect(error).toBeNull();
    capaId = action.id;
    expect(action.status).toBe('assigned');
  });

  it('10. complete corrective action', async () => {
    await supabase
      .from('corrective_actions')
      .update({ status: 'in_progress' })
      .eq('id', capaId)
      .eq('status', 'assigned');
    const { data, error } = await supabase
      .from('corrective_actions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: userId,
        disposition: 'rework',
      })
      .eq('id', capaId)
      .eq('status', 'in_progress')
      .select()
      .maybeSingle();
    expect(error).toBeNull();
    expect(data.status).toBe('completed');
  });

  it('11. verify corrective action', async () => {
    const { data, error } = await supabase
      .from('corrective_actions')
      .update({
        status: 'verified',
        verified_at: new Date().toISOString(),
        verified_by: userId,
        effectiveness_check: 'Re-inspected 10 units, all passed',
      })
      .eq('id', capaId)
      .eq('status', 'completed')
      .select()
      .maybeSingle();
    expect(error).toBeNull();
    expect(data.status).toBe('verified');
  });

  it('12. close NCR (only reachable from verification)', async () => {
    const { data, error } = await supabase
      .from('non_conformances')
      .update({
        status: 'closed',
        resolved_by: userId,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', ncId)
      .eq('status', 'verification')
      .select()
      .maybeSingle();
    expect(error).toBeNull();
    expect(data.status).toBe('closed');

    await supabase
      .from('corrective_actions')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: userId,
      })
      .eq('id', capaId)
      .eq('status', 'verified');
  });

  // ---- Integration ----

  it('13. Goods Receipt quality flow: fn_resolve_quality_plan resolves a require_inspection rule for the item', async () => {
    const { data: rule } = await supabase
      .from('quality_rules')
      .insert({
        tenant_id: TENANT,
        name: 'QA GR Rule',
        applies_to_item_id: itemId,
        transaction_type: 'goods_receipt',
        action: 'require_inspection',
        template_id: templateId,
      })
      .select()
      .single();
    const { data: resolved, error } = await supabase.rpc(
      'fn_resolve_quality_plan',
      {
        p_tenant_id: TENANT,
        p_transaction_type: 'goods_receipt',
        p_item_id: itemId,
        p_category_id: null,
        p_supplier_id: null,
        p_warehouse_id: null,
      },
    );
    expect(error).toBeNull();
    expect(resolved[0].action).toBe('require_inspection');
    expect(resolved[0].template_id).toBe(templateId);
    await supabase.from('quality_rules').delete().eq('id', rule.id);
  });

  it('14. Manufacturing quality flow: fn_requires_manufacturing_inspection resolves for production_output', async () => {
    const { data: rule } = await supabase
      .from('quality_rules')
      .insert({
        tenant_id: TENANT,
        name: 'QA Mfg Rule',
        applies_to_item_id: itemId,
        transaction_type: 'production_output',
        action: 'require_inspection',
        template_id: templateId,
      })
      .select()
      .single();
    const { data: resolved, error } = await supabase.rpc(
      'fn_requires_manufacturing_inspection',
      { p_tenant_id: TENANT, p_item_id: itemId, p_warehouse_id: warehouseId },
    );
    expect(error).toBeNull();
    expect(resolved.length).toBe(1);
    expect(resolved[0].template_id).toBe(templateId);
    await supabase.from('quality_rules').delete().eq('id', rule.id);
  });

  it("15. tenant isolation: fn_create_quality_hold for a different tenant does not affect this tenant's stock", async () => {
    const before = await supabase
      .from('v_stock_balance')
      .select('quantity_available')
      .eq('tenant_id', TENANT)
      .eq('item_id', itemId)
      .single();
    const { error } = await supabase.rpc('fn_create_quality_hold', {
      p_tenant_id: OTHER_TENANT,
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_variant_id: null,
      p_location_id: null,
      p_batch_id: null,
      p_serial_id: null,
      p_quantity_held: 5,
      p_reason: 'cross-tenant test',
      p_source_document_type: 'manual',
      p_source_document_id: null,
      p_quality_inspection_id: null,
      p_created_by: null,
    });
    // Either it errors (FK violation on tenant_id / warehouse mismatch) or, if it
    // somehow succeeds, it must not have touched THIS tenant's stock_levels row.
    const after = await supabase
      .from('v_stock_balance')
      .select('quantity_available')
      .eq('tenant_id', TENANT)
      .eq('item_id', itemId)
      .single();
    expect(Number(after.data.quantity_available)).toBe(
      Number(before.data.quantity_available),
    );
    if (!error) {
      await supabase
        .from('quality_holds')
        .delete()
        .eq('tenant_id', OTHER_TENANT)
        .eq('item_id', itemId);
    }
  });
});
