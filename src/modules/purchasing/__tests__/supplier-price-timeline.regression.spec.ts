/**
 * Regression suite for #9.6 Supplier Price History & Procurement Price
 * Timeline (Owner-approved, expanded scope). Runs directly against the
 * real shared Supabase project, instantiating the actual
 * SuppliersRepository/SuppliersService classes directly — same
 * established convention as rfq-award.regression.spec.ts. No new table,
 * no migration; this suite exercises the real join logic over
 * supplier_quote_items / purchase_order_items / goods_receipt_items.
 * Every fixture is tenant-scoped and torn down in afterAll.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import { SuppliersRepository } from '../repositories/suppliers.repository';
import { SuppliersService } from '../suppliers.service';

const TENANT = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('#9.6 Supplier Price History & Procurement Price Timeline', () => {
  let supabase: SupabaseClient;
  let service: SuppliersService;
  let branchId: string;
  let userId: string;

  const cleanup = {
    supplierIds: [] as string[],
    itemIds: [] as string[],
    rfqIds: [] as string[],
    quoteGroupIds: [] as string[],
    quoteIds: [] as string[],
    poIds: [] as string[],
    grIds: [] as string[],
    warehouseIds: [] as string[],
  };

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    service = new SuppliersService(new SuppliersRepository(supabase));

    const { data: wh } = await supabase
      .from('warehouses')
      .select('branch_id')
      .eq('tenant_id', TENANT)
      .limit(1);
    branchId = wh[0].branch_id;
    const { data: u } = await supabase
      .from('users')
      .select('id')
      .eq('tenant_id', TENANT)
      .limit(1);
    userId = u[0].id;
  }, 30000);

  afterAll(async () => {
    await supabase
      .from('goods_receipt_items')
      .delete()
      .in('goods_receipt_id', cleanup.grIds);
    await supabase.from('goods_receipts').delete().in('id', cleanup.grIds);
    await supabase
      .from('purchase_order_items')
      .delete()
      .in('purchase_order_id', cleanup.poIds);
    await supabase.from('purchase_orders').delete().in('id', cleanup.poIds);
    await supabase
      .from('supplier_quote_items')
      .delete()
      .in('supplier_quote_id', cleanup.quoteIds);
    await supabase.from('supplier_quotes').delete().in('id', cleanup.quoteIds);
    await supabase
      .from('quote_groups')
      .delete()
      .in('id', cleanup.quoteGroupIds);
    await supabase.from('rfqs').delete().in('id', cleanup.rfqIds);
    await supabase.from('items').delete().in('id', cleanup.itemIds);
    await supabase.from('suppliers').delete().in('id', cleanup.supplierIds);
    await supabase.from('warehouses').delete().in('id', cleanup.warehouseIds);
  }, 30000);

  const mkWarehouse = async () => {
    const { data, error } = await supabase
      .from('warehouses')
      .insert({
        tenant_id: TENANT,
        branch_id: branchId,
        name: 'PriceTimeline QA WH',
        code: `PTQA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      })
      .select()
      .single();
    if (error) throw error;
    cleanup.warehouseIds.push(data.id);
    return data.id as string;
  };

  const mkSupplier = async (name = 'PriceTimeline QA Supplier') => {
    const { data, error } = await supabase
      .from('suppliers')
      .insert({ tenant_id: TENANT, name, is_active: true })
      .select()
      .single();
    if (error) throw error;
    cleanup.supplierIds.push(data.id);
    return data.id as string;
  };

  const mkItem = async () => {
    const { data, error } = await supabase
      .from('items')
      .insert({
        tenant_id: TENANT,
        name: 'PriceTimeline QA Item',
        type: 'product',
        operation_type: 'sell',
        price: 10,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    cleanup.itemIds.push(data.id);
    return data.id as string;
  };

  // Builds a real quote line: rfq -> quote_group -> supplier_quote ->
  // supplier_quote_item, returning the quote item's id (what
  // purchase_order_items.source_supplier_quote_item_id references).
  const mkQuoteItem = async (
    supplierId: string,
    itemId: string,
    unitPrice: number,
    variantId: string | null = null,
  ) => {
    const { data: rfq, error: rfqErr } = await supabase
      .from('rfqs')
      .insert({
        tenant_id: TENANT,
        rfq_number: `PTQA-RFQ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'sent',
      })
      .select()
      .single();
    if (rfqErr) throw rfqErr;
    cleanup.rfqIds.push(rfq.id);

    const { data: qg, error: qgErr } = await supabase
      .from('quote_groups')
      .insert({
        tenant_id: TENANT,
        rfq_id: rfq.id,
        supplier_id: supplierId,
        quote_number: `PTQA-Q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      })
      .select()
      .single();
    if (qgErr) throw qgErr;
    cleanup.quoteGroupIds.push(qg.id);

    const { data: quote, error: quoteErr } = await supabase
      .from('supplier_quotes')
      .insert({
        tenant_id: TENANT,
        quote_group_id: qg.id,
        version: 1,
        status: 'accepted',
        currency: 'SAR',
        created_by: userId,
      })
      .select()
      .single();
    if (quoteErr) throw quoteErr;
    cleanup.quoteIds.push(quote.id);

    const { data: quoteItem, error: qiErr } = await supabase
      .from('supplier_quote_items')
      .insert({
        tenant_id: TENANT,
        supplier_quote_id: quote.id,
        item_id: itemId,
        variant_id: variantId,
        quantity_offered: 10,
        unit_price: unitPrice,
      })
      .select()
      .single();
    if (qiErr) throw qiErr;
    return quoteItem.id as string;
  };

  const mkPoWithItem = async (
    supplierId: string,
    warehouseId: string,
    itemId: string,
    unitCost: number,
    opts: {
      sourceSupplierQuoteItemId?: string;
      variantId?: string | null;
    } = {},
  ) => {
    const { data: po, error: poErr } = await supabase
      .from('purchase_orders')
      .insert({
        tenant_id: TENANT,
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        order_number: `PTQA-PO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'approved',
      })
      .select()
      .single();
    if (poErr) throw poErr;
    cleanup.poIds.push(po.id);

    const { data: poItem, error: poiErr } = await supabase
      .from('purchase_order_items')
      .insert({
        tenant_id: TENANT,
        purchase_order_id: po.id,
        item_id: itemId,
        variant_id: opts.variantId ?? null,
        quantity_ordered: 10,
        unit_cost: unitCost,
        source_supplier_quote_item_id: opts.sourceSupplierQuoteItemId ?? null,
      })
      .select()
      .single();
    if (poiErr) throw poiErr;
    return { poId: po.id as string, poItemId: poItem.id as string };
  };

  const mkGoodsReceipt = async (
    warehouseId: string,
    poId: string,
    poItemId: string,
    itemId: string,
    unitCost: number,
    variantId: string | null = null,
  ) => {
    const { data: gr, error: grErr } = await supabase
      .from('goods_receipts')
      .insert({
        tenant_id: TENANT,
        purchase_order_id: poId,
        warehouse_id: warehouseId,
        receipt_number: `PTQA-GR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'posted',
        received_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (grErr) throw grErr;
    cleanup.grIds.push(gr.id);

    const { error: griErr } = await supabase
      .from('goods_receipt_items')
      .insert({
        tenant_id: TENANT,
        goods_receipt_id: gr.id,
        purchase_order_item_id: poItemId,
        item_id: itemId,
        variant_id: variantId,
        quantity_received: 10,
        unit_cost: unitCost,
      });
    if (griErr) throw griErr;
    return gr.id as string;
  };

  it('1. full chain: Quote -> PO -> GR all appear, correctly staged', async () => {
    const supplierId = await mkSupplier();
    const warehouseId = await mkWarehouse();
    const itemId = await mkItem();

    const quoteItemId = await mkQuoteItem(supplierId, itemId, 8);
    const { poId, poItemId } = await mkPoWithItem(
      supplierId,
      warehouseId,
      itemId,
      8.5,
      { sourceSupplierQuoteItemId: quoteItemId },
    );
    await mkGoodsReceipt(warehouseId, poId, poItemId, itemId, 9);

    const result = await service.findPriceTimeline(
      supplierId,
      TENANT,
      itemId,
      {},
    );
    const stages = result.data.map((r) => r.stage);
    expect(stages).toContain('quote');
    expect(stages).toContain('purchase_order');
    expect(stages).toContain('goods_receipt');
    expect(result.total).toBe(3);

    const quoteRow = result.data.find((r) => r.stage === 'quote');
    expect(quoteRow.price).toBe(8);
    const poRow = result.data.find((r) => r.stage === 'purchase_order');
    expect(poRow.price).toBe(8.5);
    const grRow = result.data.find((r) => r.stage === 'goods_receipt');
    expect(grRow.price).toBe(9);
  }, 30000);

  it('2. PO without Quote: returns PO + GR, no fabricated Quote', async () => {
    const supplierId = await mkSupplier();
    const warehouseId = await mkWarehouse();
    const itemId = await mkItem();

    const { poId, poItemId } = await mkPoWithItem(
      supplierId,
      warehouseId,
      itemId,
      12,
    ); // no source_supplier_quote_item_id
    await mkGoodsReceipt(warehouseId, poId, poItemId, itemId, 12);

    const result = await service.findPriceTimeline(
      supplierId,
      TENANT,
      itemId,
      {},
    );
    const stages = result.data.map((r) => r.stage);
    expect(stages.sort()).toEqual(['goods_receipt', 'purchase_order']);
    expect(stages).not.toContain('quote');
  }, 30000);

  it('3. GR without PO: not attributable to a supplier, correctly absent (documented schema limitation)', async () => {
    const supplierId = await mkSupplier();
    const warehouseId = await mkWarehouse();
    const itemId = await mkItem();

    // A goods receipt with purchase_order_id = NULL cannot be attributed to
    // any supplier at all (goods_receipts has no direct supplier_id column
    // anywhere in the schema) — confirmed structurally absent from a
    // supplier-scoped timeline, not silently guessed.
    const { data: gr, error } = await supabase
      .from('goods_receipts')
      .insert({
        tenant_id: TENANT,
        purchase_order_id: null,
        warehouse_id: warehouseId,
        receipt_number: `PTQA-GR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'posted',
        received_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    cleanup.grIds.push(gr.id);
    await supabase.from('goods_receipt_items').insert({
      tenant_id: TENANT,
      goods_receipt_id: gr.id,
      purchase_order_item_id: null,
      item_id: itemId,
      quantity_received: 10,
      unit_cost: 5,
    });

    const result = await service.findPriceTimeline(
      supplierId,
      TENANT,
      itemId,
      {},
    );
    expect(result.total).toBe(0);
  }, 30000);

  it('4. multiple price changes over time are all returned', async () => {
    const supplierId = await mkSupplier();
    const warehouseId = await mkWarehouse();
    const itemId = await mkItem();

    const { poId: poId1, poItemId: poItemId1 } = await mkPoWithItem(
      supplierId,
      warehouseId,
      itemId,
      10,
    );
    await mkGoodsReceipt(warehouseId, poId1, poItemId1, itemId, 10);
    const { poId: poId2, poItemId: poItemId2 } = await mkPoWithItem(
      supplierId,
      warehouseId,
      itemId,
      11,
    );
    await mkGoodsReceipt(warehouseId, poId2, poItemId2, itemId, 11);
    const { poId: poId3, poItemId: poItemId3 } = await mkPoWithItem(
      supplierId,
      warehouseId,
      itemId,
      12,
    );
    await mkGoodsReceipt(warehouseId, poId3, poItemId3, itemId, 12);

    const result = await service.findPriceTimeline(
      supplierId,
      TENANT,
      itemId,
      {},
    );
    expect(result.total).toBe(6); // 3 POs + 3 GRs
    const grPrices = result.data
      .filter((r) => r.stage === 'goods_receipt')
      .map((r) => r.price)
      .sort();
    expect(grPrices).toEqual([10, 11, 12]);
  }, 30000);

  it('5. ordering: results are returned latest-first', async () => {
    const supplierId = await mkSupplier();
    const warehouseId = await mkWarehouse();
    const itemId = await mkItem();

    const { poId: poId1, poItemId: poItemId1 } = await mkPoWithItem(
      supplierId,
      warehouseId,
      itemId,
      10,
    );
    await mkGoodsReceipt(warehouseId, poId1, poItemId1, itemId, 10);
    await new Promise((r) => setTimeout(r, 1100)); // ensure a distinct received_at second
    const { poId: poId2, poItemId: poItemId2 } = await mkPoWithItem(
      supplierId,
      warehouseId,
      itemId,
      20,
    );
    await mkGoodsReceipt(warehouseId, poId2, poItemId2, itemId, 20);

    const result = await service.findPriceTimeline(
      supplierId,
      TENANT,
      itemId,
      {},
    );
    const grDates = result.data
      .filter((r) => r.stage === 'goods_receipt')
      .map((r) => new Date(r.date).getTime());
    expect(grDates[0]).toBeGreaterThanOrEqual(grDates[1]);
  }, 30000);

  it("6. supplier isolation: another supplier's prices for the same item never appear", async () => {
    const supplierA = await mkSupplier('PriceTimeline QA Supplier A');
    const supplierB = await mkSupplier('PriceTimeline QA Supplier B');
    const warehouseId = await mkWarehouse();
    const itemId = await mkItem();

    const { poId: poIdA, poItemId: poItemIdA } = await mkPoWithItem(
      supplierA,
      warehouseId,
      itemId,
      100,
    );
    await mkGoodsReceipt(warehouseId, poIdA, poItemIdA, itemId, 100);
    const { poId: poIdB, poItemId: poItemIdB } = await mkPoWithItem(
      supplierB,
      warehouseId,
      itemId,
      999,
    );
    await mkGoodsReceipt(warehouseId, poIdB, poItemIdB, itemId, 999);

    const result = await service.findPriceTimeline(
      supplierA,
      TENANT,
      itemId,
      {},
    );
    const prices = result.data.map((r) => r.price);
    expect(prices).not.toContain(999);
    expect(prices).toContain(100);
  }, 30000);

  it('7. tenant isolation: a supplier id from another tenant is rejected (404)', async () => {
    const { data: otherTenant } = await supabase
      .from('tenants')
      .select('id')
      .neq('id', TENANT)
      .limit(1);
    if (!otherTenant?.[0]) return;
    const supplierId = await mkSupplier();
    const itemId = await mkItem();

    await expect(
      service.findPriceTimeline(supplierId, otherTenant[0].id, itemId, {}),
    ).rejects.toThrow();
  }, 30000);

  it("8. variant isolation: a different variant's price never appears when variant_id is specified", async () => {
    const supplierId = await mkSupplier();
    const warehouseId = await mkWarehouse();
    const itemId = await mkItem();

    const { data: variantA } = await supabase
      .from('item_variants')
      .insert({
        tenant_id: TENANT,
        item_id: itemId,
        name: 'Variant A',
        sku: `PTQA-VA-${Date.now()}`,
      })
      .select()
      .single();
    const { data: variantB } = await supabase
      .from('item_variants')
      .insert({
        tenant_id: TENANT,
        item_id: itemId,
        name: 'Variant B',
        sku: `PTQA-VB-${Date.now()}`,
      })
      .select()
      .single();

    const { poId: poIdA, poItemId: poItemIdA } = await mkPoWithItem(
      supplierId,
      warehouseId,
      itemId,
      50,
      { variantId: variantA.id },
    );
    await mkGoodsReceipt(
      warehouseId,
      poIdA,
      poItemIdA,
      itemId,
      50,
      variantA.id,
    );
    const { poId: poIdB, poItemId: poItemIdB } = await mkPoWithItem(
      supplierId,
      warehouseId,
      itemId,
      75,
      { variantId: variantB.id },
    );
    await mkGoodsReceipt(
      warehouseId,
      poIdB,
      poItemIdB,
      itemId,
      75,
      variantB.id,
    );

    const result = await service.findPriceTimeline(supplierId, TENANT, itemId, {
      variant_id: variantA.id,
    });
    const prices = result.data.map((r) => r.price);
    expect(prices).toContain(50);
    expect(prices).not.toContain(75);

    await supabase
      .from('purchase_order_items')
      .delete()
      .in('purchase_order_id', [poIdA, poIdB]);
    await supabase
      .from('item_variants')
      .delete()
      .in('id', [variantA.id, variantB.id]);
  }, 30000);

  it('9. not found: a real supplier id under the correct tenant but no matching item returns an empty timeline (permission/route reachable, no fabricated rows)', async () => {
    const supplierId = await mkSupplier();
    const itemId = await mkItem(); // no PO/GR/Quote created for this item at all

    const result = await service.findPriceTimeline(
      supplierId,
      TENANT,
      itemId,
      {},
    );
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  }, 30000);
});
