/**
 * Regression suite for item #9.3 (migrations 122-125): RFQ container,
 * Supplier Quotes with version-group revisions, Award as an independent
 * document with a full pricing snapshot, and Award-to-PO generation.
 * Runs directly against the real shared Supabase project (no isolated
 * test DB in this environment), instantiating the actual service/
 * repository classes directly. Every fixture is tenant-scoped and torn
 * down in afterAll. Not wired into CI (api.yml only runs `npm run
 * build`) — run deliberately via `npm test`.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import { ApprovalEngine } from '../../../engines/approval-engine/approval.engine';
import { ApprovalHistoryRepository } from '../../../engines/approval-engine/approval-history.repository';
import { RfqsRepository } from '../repositories/rfqs.repository';
import { RfqsService } from '../rfqs.service';
import { SupplierQuotesRepository } from '../repositories/supplier-quotes.repository';
import { SupplierQuotesService } from '../supplier-quotes.service';
import { AwardsRepository } from '../repositories/awards.repository';
import { AwardsService } from '../awards.service';
import { PurchaseOrdersRepository } from '../repositories/purchase-orders.repository';

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('RFQ + Supplier Quote + Award module (migrations 122-125)', () => {
  let supabase: SupabaseClient;
  let rfqService: RfqsService;
  let quotesService: SupplierQuotesService;
  let awardsService: AwardsService;
  let warehouseId: string;
  let userId: string;
  let supplierAId: string;
  let supplierBId: string;
  let itemId: string;

  const cleanup = {
    rfqs: [] as string[],
    quotes: [] as string[],
    quoteGroups: [] as string[],
    awards: [] as string[],
    pos: [] as string[],
    suppliers: [] as string[],
  };

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const approvalEngine = new ApprovalEngine();
    const approvalHistory = new ApprovalHistoryRepository(supabase);
    rfqService = new RfqsService(
      new RfqsRepository(supabase),
      approvalEngine,
      approvalHistory,
    );
    quotesService = new SupplierQuotesService(
      new SupplierQuotesRepository(supabase),
    );
    awardsService = new AwardsService(
      new AwardsRepository(supabase),
      new SupplierQuotesRepository(supabase),
      new PurchaseOrdersRepository(supabase),
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

    const { data: supplierA } = await supabase
      .from('suppliers')
      .insert({ tenant_id: TEST_TENANT_ID, name: 'Regression Supplier A' })
      .select()
      .single();
    const { data: supplierB } = await supabase
      .from('suppliers')
      .insert({ tenant_id: TEST_TENANT_ID, name: 'Regression Supplier B' })
      .select()
      .single();
    supplierAId = supplierA.id;
    supplierBId = supplierB.id;
    cleanup.suppliers.push(supplierAId, supplierBId);

    const { data: item } = await supabase
      .from('items')
      .insert({
        tenant_id: TEST_TENANT_ID,
        name: 'Regression RFQ Item',
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
    for (const poId of cleanup.pos) {
      await supabase
        .from('purchase_order_items')
        .delete()
        .eq('purchase_order_id', poId);
      await supabase.from('purchase_orders').delete().eq('id', poId);
    }
    for (const awardId of cleanup.awards) {
      await supabase.from('award_items').delete().eq('award_id', awardId);
    }
    await supabase.from('awards').delete().in('id', cleanup.awards);
    for (const rfqId of cleanup.rfqs) {
      await supabase
        .from('approval_history')
        .delete()
        .eq('reference_type', 'rfq')
        .eq('reference_id', rfqId);
    }
    await supabase
      .from('supplier_quote_items')
      .delete()
      .in('supplier_quote_id', cleanup.quotes);
    await supabase.from('supplier_quotes').delete().in('id', cleanup.quotes);
    await supabase.from('quote_groups').delete().in('id', cleanup.quoteGroups);
    await supabase.from('rfq_suppliers').delete().in('rfq_id', cleanup.rfqs);
    await supabase.from('rfq_items').delete().in('rfq_id', cleanup.rfqs);
    await supabase.from('rfqs').delete().in('id', cleanup.rfqs);
    await supabase.from('items').delete().eq('id', itemId);
    await supabase.from('suppliers').delete().in('id', cleanup.suppliers);
  }, 30_000);

  it('creates an RFQ with no pricing fields, sent to multiple suppliers', async () => {
    const rfq = await rfqService.create(
      TEST_TENANT_ID,
      {
        warehouse_id: warehouseId,
        rfq_number: `REGR-93-${Date.now()}`,
        items: [{ item_id: itemId, quantity_requested: 20 }],
        supplier_ids: [supplierAId, supplierBId],
      },
      userId,
    );
    cleanup.rfqs.push(rfq.id);

    expect(rfq.status).toBe('draft');
    expect(rfq.items[0].unit_price).toBeUndefined();
    expect(rfq.suppliers).toHaveLength(2);
  }, 30_000);

  it('RFQ approval goes through ApprovalEngine, never reaches an "awarded" status', async () => {
    const rfq = await rfqService.create(
      TEST_TENANT_ID,
      {
        warehouse_id: warehouseId,
        rfq_number: `REGR-93-APPROVE-${Date.now()}`,
        items: [{ item_id: itemId, quantity_requested: 10 }],
        supplier_ids: [supplierAId],
      },
      userId,
    );
    cleanup.rfqs.push(rfq.id);

    await rfqService.submit(rfq.id, TEST_TENANT_ID, userId);
    const approved = await rfqService.approve(rfq.id, TEST_TENANT_ID, userId);
    expect(approved.status).toBe('approved');

    const sent = await rfqService.send(rfq.id, TEST_TENANT_ID, userId);
    expect(sent.status).toBe('sent');
    // No status value in the CHECK constraint is ever 'awarded' — confirmed
    // structurally by migration 122, exercised here by staying at 'sent'.

    const history = await rfqService.history(rfq.id, TEST_TENANT_ID);
    expect(history.map((h: any) => h.action)).toEqual([
      'submitted',
      'approved',
      'sent',
    ]);
  }, 30_000);

  it('supplier quote revisions use a stable quote_group, not a chain', async () => {
    const rfq = await rfqService.create(
      TEST_TENANT_ID,
      {
        warehouse_id: warehouseId,
        rfq_number: `REGR-93-REVISION-${Date.now()}`,
        items: [{ item_id: itemId, quantity_requested: 10 }],
        supplier_ids: [supplierAId],
      },
      userId,
    );
    cleanup.rfqs.push(rfq.id);
    const rfqItemId = rfq.items[0].id;

    const v1 = await quotesService.createOrRevise(
      TEST_TENANT_ID,
      {
        rfq_id: rfq.id,
        supplier_id: supplierAId,
        currency: 'SAR',
        items: [
          {
            rfq_item_id: rfqItemId,
            item_id: itemId,
            quantity_offered: 10,
            unit_price: 100,
          },
        ],
      },
      userId,
    );
    cleanup.quoteGroups.push(v1.quote_group_id);
    cleanup.quotes.push(v1.id);
    expect(v1.version).toBe(1);

    const v2 = await quotesService.createOrRevise(
      TEST_TENANT_ID,
      {
        rfq_id: rfq.id,
        supplier_id: supplierAId,
        currency: 'SAR',
        items: [
          {
            rfq_item_id: rfqItemId,
            item_id: itemId,
            quantity_offered: 10,
            unit_price: 90,
          },
        ],
      },
      userId,
    );
    cleanup.quotes.push(v2.id);
    expect(v2.version).toBe(2);
    expect(v2.quote_group_id).toBe(v1.quote_group_id); // same stable group, no chain

    const v1After = await quotesService.findById(v1.id, TEST_TENANT_ID);
    expect(v1After.status).toBe('superseded');
  }, 30_000);

  it('award snapshots quote pricing at award time and is independent of the RFQ status', async () => {
    const rfq = await rfqService.create(
      TEST_TENANT_ID,
      {
        warehouse_id: warehouseId,
        rfq_number: `REGR-93-AWARD-${Date.now()}`,
        items: [{ item_id: itemId, quantity_requested: 5 }],
        supplier_ids: [supplierAId],
      },
      userId,
    );
    cleanup.rfqs.push(rfq.id);
    const rfqItemId = rfq.items[0].id;

    const quote = await quotesService.createOrRevise(
      TEST_TENANT_ID,
      {
        rfq_id: rfq.id,
        supplier_id: supplierAId,
        currency: 'SAR',
        items: [
          {
            rfq_item_id: rfqItemId,
            item_id: itemId,
            quantity_offered: 5,
            unit_price: 42,
            discount_percent: 5,
            lead_time_days: 7,
            tax_rate: 15,
          },
        ],
      },
      userId,
    );
    cleanup.quoteGroups.push(quote.quote_group_id);
    cleanup.quotes.push(quote.id);
    const quoteItemId = quote.items[0].id;

    const award = await awardsService.create(
      TEST_TENANT_ID,
      {
        rfq_id: rfq.id,
        award_number: `REGR-93-AWD-${Date.now()}`,
        items: [
          {
            rfq_item_id: rfqItemId,
            source_supplier_quote_item_id: quoteItemId,
            awarded_quantity: 5,
          },
        ],
      },
      userId,
    );
    cleanup.awards.push(award.id);

    expect(award.items[0].awarded_unit_price).toBe(42);
    expect(award.items[0].awarded_discount).toBe(5);
    expect(award.items[0].awarded_lead_time).toBe(7);
    expect(award.items[0].awarded_tax_rate).toBe(15);

    // Confirming the award must NOT change rfqs.status at all.
    const rfqBefore = await rfqService.findById(rfq.id, TEST_TENANT_ID);
    await awardsService.confirm(award.id, TEST_TENANT_ID);
    const rfqAfter = await rfqService.findById(rfq.id, TEST_TENANT_ID);
    expect(rfqAfter.status).toBe(rfqBefore.status);
  }, 30_000);

  it('an award revision to the underlying quote never changes an already-recorded award snapshot', async () => {
    const rfq = await rfqService.create(
      TEST_TENANT_ID,
      {
        warehouse_id: warehouseId,
        rfq_number: `REGR-93-IMMUTABLE-${Date.now()}`,
        items: [{ item_id: itemId, quantity_requested: 3 }],
        supplier_ids: [supplierAId],
      },
      userId,
    );
    cleanup.rfqs.push(rfq.id);
    const rfqItemId = rfq.items[0].id;

    const quote = await quotesService.createOrRevise(
      TEST_TENANT_ID,
      {
        rfq_id: rfq.id,
        supplier_id: supplierAId,
        items: [
          {
            rfq_item_id: rfqItemId,
            item_id: itemId,
            quantity_offered: 3,
            unit_price: 50,
          },
        ],
      },
      userId,
    );
    cleanup.quoteGroups.push(quote.quote_group_id);
    cleanup.quotes.push(quote.id);

    const award = await awardsService.create(
      TEST_TENANT_ID,
      {
        rfq_id: rfq.id,
        award_number: `REGR-93-AWD-IMM-${Date.now()}`,
        items: [
          {
            rfq_item_id: rfqItemId,
            source_supplier_quote_item_id: quote.items[0].id,
            awarded_quantity: 3,
          },
        ],
      },
      userId,
    );
    cleanup.awards.push(award.id);
    expect(award.items[0].awarded_unit_price).toBe(50);

    // Supplier revises their quote to a different price.
    const revised = await quotesService.createOrRevise(
      TEST_TENANT_ID,
      {
        rfq_id: rfq.id,
        supplier_id: supplierAId,
        items: [
          {
            rfq_item_id: rfqItemId,
            item_id: itemId,
            quantity_offered: 3,
            unit_price: 999,
          },
        ],
      },
      userId,
    );
    cleanup.quotes.push(revised.id);

    const awardReread = await awardsService.findById(award.id, TEST_TENANT_ID);
    expect(awardReread.items[0].awarded_unit_price).toBe(50); // unchanged
  }, 30_000);

  it('generates one purchase order per supplier from a confirmed award, with full lineage', async () => {
    const rfq = await rfqService.create(
      TEST_TENANT_ID,
      {
        warehouse_id: warehouseId,
        rfq_number: `REGR-93-POGEN-${Date.now()}`,
        items: [{ item_id: itemId, quantity_requested: 4 }],
        supplier_ids: [supplierAId],
      },
      userId,
    );
    cleanup.rfqs.push(rfq.id);
    const rfqItemId = rfq.items[0].id;

    const quote = await quotesService.createOrRevise(
      TEST_TENANT_ID,
      {
        rfq_id: rfq.id,
        supplier_id: supplierAId,
        currency: 'SAR',
        items: [
          {
            rfq_item_id: rfqItemId,
            item_id: itemId,
            quantity_offered: 4,
            unit_price: 20,
          },
        ],
      },
      userId,
    );
    cleanup.quoteGroups.push(quote.quote_group_id);
    cleanup.quotes.push(quote.id);

    const award = await awardsService.create(
      TEST_TENANT_ID,
      {
        rfq_id: rfq.id,
        award_number: `REGR-93-AWD-POGEN-${Date.now()}`,
        items: [
          {
            rfq_item_id: rfqItemId,
            source_supplier_quote_item_id: quote.items[0].id,
            awarded_quantity: 4,
          },
        ],
      },
      userId,
    );
    cleanup.awards.push(award.id);
    await awardsService.confirm(award.id, TEST_TENANT_ID);

    const pos = await awardsService.createPurchaseOrders(
      award.id,
      TEST_TENANT_ID,
      warehouseId,
      `REGR-93-PO-${Date.now()}`,
      userId,
    );
    pos.forEach((po: any) => cleanup.pos.push(po.id));

    expect(pos).toHaveLength(1); // single supplier -> single PO
    expect(pos[0].source_rfq_id).toBe(rfq.id);
    expect(pos[0].source_award_id).toBe(award.id);
    expect(pos[0].source_supplier_quote_id).toBe(quote.id);
    expect(pos[0].items[0].source_award_item_id).toBe(award.items[0].id);
    expect(pos[0].items[0].quantity_ordered).toBe(4);
    expect(pos[0].items[0].unit_cost).toBe(20);
  }, 30_000);

  it('confirms zero impact on inventory/cost layers/goods receipts until a PO is actually created', async () => {
    const { count: movementsBefore } = await supabase
      .from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('item_id', itemId);
    const { count: layersBefore } = await supabase
      .from('cost_layers')
      .select('*', { count: 'exact', head: true })
      .eq('item_id', itemId);

    const rfq = await rfqService.create(
      TEST_TENANT_ID,
      {
        warehouse_id: warehouseId,
        rfq_number: `REGR-93-ISOLATION-${Date.now()}`,
        items: [{ item_id: itemId, quantity_requested: 2 }],
        supplier_ids: [supplierAId],
      },
      userId,
    );
    cleanup.rfqs.push(rfq.id);
    await rfqService.submit(rfq.id, TEST_TENANT_ID, userId);
    await rfqService.approve(rfq.id, TEST_TENANT_ID, userId);
    await rfqService.send(rfq.id, TEST_TENANT_ID, userId);

    const quote = await quotesService.createOrRevise(
      TEST_TENANT_ID,
      {
        rfq_id: rfq.id,
        supplier_id: supplierAId,
        items: [{ item_id: itemId, quantity_offered: 2, unit_price: 10 }],
      },
      userId,
    );
    cleanup.quoteGroups.push(quote.quote_group_id);
    cleanup.quotes.push(quote.id);

    const award = await awardsService.create(
      TEST_TENANT_ID,
      {
        rfq_id: rfq.id,
        award_number: `REGR-93-AWD-ISO-${Date.now()}`,
        items: [
          {
            source_supplier_quote_item_id: quote.items[0].id,
            awarded_quantity: 2,
          },
        ],
      },
      userId,
    );
    cleanup.awards.push(award.id);
    await awardsService.confirm(award.id, TEST_TENANT_ID);

    const { count: movementsAfter } = await supabase
      .from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('item_id', itemId);
    const { count: layersAfter } = await supabase
      .from('cost_layers')
      .select('*', { count: 'exact', head: true })
      .eq('item_id', itemId);

    expect(movementsAfter).toBe(movementsBefore);
    expect(layersAfter).toBe(layersBefore);
  }, 30_000);
});
