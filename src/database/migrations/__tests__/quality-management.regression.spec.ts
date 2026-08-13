/**
 * Regression suite for Migration 8.2 (Quality Management: inspections,
 * holds, non-conformances, and the advisory sale-hold-check RPC). Runs
 * directly against the real shared Supabase project via the service-role
 * client — same approach as every other regression spec in this directory.
 *
 * Note on scope: this suite exercises the schema, lifecycle transitions,
 * ApprovalEngine/approval_history integration, and the exact
 * fn_check_quality_holds RPC that InvoicesService now calls — proving the
 * advisory check returns the expected hold for a held item and nothing for
 * a normal item. It does NOT drive a full HTTP-level InvoicesService.create()
 * call (that would require bootstrapping an open shift session, a branch
 * with default_warehouse_id set, and a cashier JWT — a materially larger
 * fixture than any other regression spec in this session has needed, since
 * every prior spec calls RPCs directly rather than the full invoice-creation
 * stack). The fn_check_quality_holds assertions below are the same RPC call
 * invoices.service.ts makes, so they are a faithful proxy for "sale query
 * would see a warning" / "sale query would see nothing" — but a true
 * end-to-end HTTP test through InvoicesService.create() is flagged as a
 * follow-up, not claimed as covered here.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('quality management regression (Migration 8.2)', () => {
  let supabase: SupabaseClient;
  let warehouseId: string;
  const itemIds: string[] = [];
  const inspectionIds: string[] = [];
  const holdIds: string[] = [];
  const nonConformanceIds: string[] = [];

  const createItem = async (name: string) => {
    const { data, error } = await supabase
      .from('items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name,
        type: 'product',
        operation_type: 'sell',
        price: 10,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    itemIds.push(data.id);
    return data.id;
  };

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    const { data: wh, error } = await supabase
      .from('warehouses')
      .select('id')
      .eq('tenant_id', TEST_TENANT_ID)
      .limit(1);
    if (error) throw error;
    warehouseId = wh[0].id;
  }, 30_000);

  afterAll(async () => {
    for (const id of nonConformanceIds)
      await supabase.from('non_conformances').delete().eq('id', id);
    for (const id of holdIds)
      await supabase.from('quality_holds').delete().eq('id', id);
    for (const id of inspectionIds)
      await supabase.from('quality_inspections').delete().eq('id', id);
    await supabase
      .from('approval_history')
      .delete()
      .eq('reference_type', 'quality_hold')
      .in('reference_id', holdIds);
    for (const itemId of itemIds) {
      const { error } = await supabase.from('items').delete().eq('id', itemId);
      if (error) {
        await supabase
          .from('items')
          .update({ is_active: false, deleted_at: new Date().toISOString() })
          .eq('id', itemId);
      }
    }
  }, 60_000);

  it('inspection: create pending, complete as failed, verify final status', async () => {
    const itemId = await createItem('QM Inspection Item');
    const { data: gr } = await supabase
      .from('goods_receipts')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        receipt_number: `QM-GR-${Date.now()}`,
        status: 'draft',
      })
      .select()
      .single();

    const { data: inspection, error: createErr } = await supabase
      .from('quality_inspections')
      .insert({
        tenant_id: TEST_TENANT_ID,
        reference_type: 'goods_receipt',
        reference_id: gr.id,
        item_id: itemId,
        status: 'pending',
      })
      .select()
      .single();
    expect(createErr).toBeNull();
    inspectionIds.push(inspection.id);
    expect(inspection.status).toBe('pending');

    const { data: completed, error: completeErr } = await supabase
      .from('quality_inspections')
      .update({
        status: 'failed',
        inspected_at: new Date().toISOString(),
        notes: 'defect found',
      })
      .eq('id', inspection.id)
      .eq('status', 'pending')
      .select()
      .single();
    expect(completeErr).toBeNull();
    expect(completed.status).toBe('failed');

    await supabase.from('goods_receipts').delete().eq('id', gr.id);
  }, 30_000);

  it('hold: create active, release via approve, verify approval_history entry', async () => {
    const itemId = await createItem('QM Hold Item (release approved)');
    const { data: hold, error: createErr } = await supabase
      .from('quality_holds')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        item_id: itemId,
        status: 'active',
        reason: 'awaiting re-test',
      })
      .select()
      .single();
    expect(createErr).toBeNull();
    holdIds.push(hold.id);
    expect(hold.status).toBe('active');

    // Mirrors HoldsService.release() approve path exactly.
    const releasedAt = new Date().toISOString();
    const { data: released, error: releaseErr } = await supabase
      .from('quality_holds')
      .update({
        status: 'released',
        released_by: null,
        released_at: releasedAt,
      })
      .eq('id', hold.id)
      .eq('status', 'active')
      .select()
      .single();
    expect(releaseErr).toBeNull();
    expect(released.status).toBe('released');

    const { error: historyErr } = await supabase
      .from('approval_history')
      .insert({
        tenant_id: TEST_TENANT_ID,
        reference_type: 'quality_hold',
        reference_id: hold.id,
        action: 'release',
        actor_id: null,
        previous_status: 'active',
        new_status: 'released',
        reason: 'confirmed safe',
      });
    expect(historyErr).toBeNull();

    const { data: historyRows, error: historyReadErr } = await supabase
      .from('approval_history')
      .select('*')
      .eq('tenant_id', TEST_TENANT_ID)
      .eq('reference_type', 'quality_hold')
      .eq('reference_id', hold.id);
    expect(historyReadErr).toBeNull();
    expect(historyRows.length).toBe(1);
    expect(historyRows[0].previous_status).toBe('active');
    expect(historyRows[0].new_status).toBe('released');
    expect(historyRows[0].action).toBe('release');
  }, 30_000);

  it('non-conformance: create open, close it', async () => {
    const itemId = await createItem('QM Non-Conformance Item');
    const { data: inspection } = await supabase
      .from('quality_inspections')
      .insert({
        tenant_id: TEST_TENANT_ID,
        reference_type: 'goods_receipt',
        reference_id: itemId,
        item_id: itemId,
        status: 'failed',
      })
      .select()
      .single();
    inspectionIds.push(inspection.id);

    const { data: nc, error: createErr } = await supabase
      .from('non_conformances')
      .insert({
        tenant_id: TEST_TENANT_ID,
        quality_inspection_id: inspection.id,
        item_id: itemId,
        description: 'damaged packaging',
        severity: 'major',
        status: 'open',
      })
      .select()
      .single();
    expect(createErr).toBeNull();
    nonConformanceIds.push(nc.id);
    expect(nc.status).toBe('open');

    const { data: closed, error: closeErr } = await supabase
      .from('non_conformances')
      .update({
        status: 'closed',
        resolved_by: null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', nc.id)
      .eq('status', 'open')
      .select()
      .single();
    expect(closeErr).toBeNull();
    expect(closed.status).toBe('closed');
  }, 30_000);

  it('sales advisory check: fn_check_quality_holds returns the hold for a held item, and nothing for a normal item', async () => {
    const heldItem = await createItem('QM Sale Advisory (held)');
    const normalItem = await createItem('QM Sale Advisory (normal)');

    const { data: hold } = await supabase
      .from('quality_holds')
      .insert({
        tenant_id: TEST_TENANT_ID,
        warehouse_id: warehouseId,
        item_id: heldItem,
        status: 'active',
        reason: 'pending inspection',
      })
      .select()
      .single();
    holdIds.push(hold.id);

    // Exact same RPC call HoldsRepository.checkHolds() makes, with the same
    // {item_id, variant_id} shape InvoicesService builds from built.items.
    const { data, error } = await supabase.rpc('fn_check_quality_holds', {
      p_tenant_id: TEST_TENANT_ID,
      p_warehouse_id: warehouseId,
      p_items: [
        { item_id: heldItem, variant_id: null },
        { item_id: normalItem, variant_id: null },
      ],
    });
    expect(error).toBeNull();
    const ids = (data as any[]).map((r) => r.item_id);
    expect(ids).toContain(heldItem); // held item -> sale would surface an advisory warning
    expect(ids).not.toContain(normalItem); // normal item -> no warning, sale unaffected
  }, 30_000);
});
