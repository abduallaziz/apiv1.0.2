import { Injectable } from '@nestjs/common';
import { ScopedRepository } from '../../../core/tenant/scoped.repository';
import { SupabaseClient } from '@supabase/supabase-js';
import { TenantContext } from '../../../core/tenant/tenant.context';

@Injectable()
export class SuppliersRepository extends ScopedRepository {
  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  private ctx(tenantId: string): TenantContext {
    return { tenantId } as TenantContext;
  }

  async findAll(tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'suppliers',
      this.ctx(tenantId),
    ).order('name');
    if (error) throw error;
    return data;
  }

  async findById(id: string, tenantId: string) {
    const { data, error } = await this.scopedQuery(
      'suppliers',
      this.ctx(tenantId),
    )
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('suppliers')
      .insert({
        ...payload,
        tenant_id: tenantId,
        is_active: payload.is_active ?? true,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, tenantId: string, payload: Record<string, unknown>) {
    const { data, error } = await this.supabase
      .from('suppliers')
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async softDelete(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('suppliers')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) throw error;
  }

  async findProfileStats(id: string, tenantId: string) {
    const { data, error } = await this.supabase.rpc(
      'fn_supplier_profile_stats',
      {
        p_tenant_id: tenantId,
        p_supplier_id: id,
      },
    );
    if (error) throw error;
    return data?.[0] ?? null;
  }

  // #9.6 Supplier Price History & Procurement Price Timeline
  // (Owner-approved, expanded scope). Unified read model over three real,
  // already-existing tables — no new table, no migration, no new pricing
  // engine. Goods Receipt is the actual-purchase-price source of truth;
  // Quote and PO are historical negotiation context, linked via the real
  // lineage columns migration 125 already added
  // (purchase_order_items.source_supplier_quote_item_id,
  // goods_receipt_items.purchase_order_item_id — both nullable).
  //
  // Scoped supplier -> PO -> [Quote via PO's lineage] and supplier -> PO ->
  // GR (via each PO item's own receipt lines). A goods receipt with no
  // purchase_order_id at all cannot appear here: `goods_receipts` has no
  // direct supplier_id column anywhere in the schema, so an unlinked
  // receipt has no way to be attributed to a specific supplier — it is
  // correctly excluded from a *supplier*-scoped timeline, not silently
  // guessed. This is the one documented gap between the originally
  // described "Case 2: Receipt without PO -> GR only" and what a
  // supplier-scoped endpoint can structurally support.
  //
  // Three bounded, indexed queries (by supplier's PO ids, then by those
  // POs' item ids) — not N+1, not a per-row loop. Merge/sort/paginate
  // happens in application code since combining three heterogeneous
  // sources into one page-based result isn't expressible as a single
  // PostgREST query without a new DB view (explicitly avoided per the
  // approved "no new table, no migration unless a real blocker" scope).
  async findPriceTimeline(
    tenantId: string,
    supplierId: string,
    itemId: string,
    variantId?: string,
  ) {
    const variantFilter = (query: any) =>
      variantId ? query.eq('variant_id', variantId) : query;

    // This supplier's own POs (bounded — one supplier's purchase history,
    // not tenant-wide).
    const { data: pos, error: poErr } = await this.supabase
      .from('purchase_orders')
      .select('id, warehouse_id, order_date, created_at')
      .eq('tenant_id', tenantId)
      .eq('supplier_id', supplierId);
    if (poErr) throw poErr;
    const poIds = (pos ?? []).map((p) => p.id);
    const poById = new Map((pos ?? []).map((p) => [p.id, p]));
    if (poIds.length === 0) return [];

    // PO stage: this item's lines across this supplier's POs.
    let poItemsQuery = this.supabase
      .from('purchase_order_items')
      .select(
        'id, purchase_order_id, item_id, variant_id, unit_cost, quantity_ordered, source_supplier_quote_item_id, created_at',
      )
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .in('purchase_order_id', poIds);
    poItemsQuery = variantFilter(poItemsQuery);
    const { data: poItems, error: poItemsErr } = await poItemsQuery;
    if (poItemsErr) throw poItemsErr;
    const poItemIds = (poItems ?? []).map((pi) => pi.id);

    // Goods Receipt stage: receipt lines for this item, linked to any of
    // this supplier's PO items above.
    let grItemsQuery = this.supabase
      .from('goods_receipt_items')
      .select(
        'id, goods_receipt_id, purchase_order_item_id, item_id, variant_id, unit_cost, quantity_received, created_at, goods_receipts(id, warehouse_id, receipt_number, received_at, status)',
      )
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId);
    grItemsQuery = variantFilter(grItemsQuery);
    grItemsQuery =
      poItemIds.length > 0
        ? grItemsQuery.in('purchase_order_item_id', poItemIds)
        : grItemsQuery.eq(
            'purchase_order_item_id',
            '00000000-0000-0000-0000-000000000000',
          );
    const { data: grItems, error: grItemsErr } = await grItemsQuery;
    if (grItemsErr) throw grItemsErr;

    // Quote stage: only the quote lines actually referenced by one of this
    // supplier's PO items above (source_supplier_quote_item_id) — never a
    // blanket "every quote this supplier ever sent," which would include
    // quotes unrelated to any real PO for this item.
    const quoteItemIds = [
      ...new Set(
        (poItems ?? [])
          .map((pi) => pi.source_supplier_quote_item_id)
          .filter((v): v is string => !!v),
      ),
    ];
    let quoteItems: any[] = [];
    if (quoteItemIds.length > 0) {
      const { data, error } = await this.supabase
        .from('supplier_quote_items')
        .select(
          'id, supplier_quote_id, item_id, variant_id, unit_price, quantity_offered, created_at, supplier_quotes(id, status, created_at, quote_group_id)',
        )
        .eq('tenant_id', tenantId)
        .in('id', quoteItemIds);
      if (error) throw error;
      quoteItems = data ?? [];
    }
    const quoteItemById = new Map(quoteItems.map((qi) => [qi.id, qi]));

    const rows: Array<{
      stage: 'quote' | 'purchase_order' | 'goods_receipt';
      supplier_id: string;
      item_id: string;
      variant_id: string | null;
      price: number;
      quantity: number | null;
      document_id: string;
      warehouse_id: string | null;
      date: string;
      source_reference: Record<string, unknown>;
    }> = [];

    for (const qi of quoteItems) {
      const quote = (
        Array.isArray(qi.supplier_quotes)
          ? qi.supplier_quotes[0]
          : qi.supplier_quotes
      ) as
        | {
            id: string;
            status: string;
            created_at: string;
            quote_group_id: string;
          }
        | undefined;
      rows.push({
        stage: 'quote',
        supplier_id: supplierId,
        item_id: qi.item_id,
        variant_id: qi.variant_id,
        price: qi.unit_price,
        quantity: qi.quantity_offered ?? null,
        document_id: qi.supplier_quote_id,
        warehouse_id: null,
        date: quote?.created_at ?? qi.created_at,
        source_reference: {
          supplier_quote_item_id: qi.id,
          supplier_quote_status: quote?.status ?? null,
        },
      });
    }

    for (const pi of poItems ?? []) {
      const po = poById.get(pi.purchase_order_id);
      rows.push({
        stage: 'purchase_order',
        supplier_id: supplierId,
        item_id: pi.item_id,
        variant_id: pi.variant_id,
        price: pi.unit_cost,
        quantity: pi.quantity_ordered ?? null,
        document_id: pi.purchase_order_id,
        warehouse_id: po?.warehouse_id ?? null,
        date: po?.order_date ?? po?.created_at ?? pi.created_at,
        source_reference: {
          purchase_order_item_id: pi.id,
          source_supplier_quote_item_id: pi.source_supplier_quote_item_id,
          matched_quote: pi.source_supplier_quote_item_id
            ? !!quoteItemById.get(pi.source_supplier_quote_item_id)
            : false,
        },
      });
    }

    for (const gi of grItems ?? []) {
      const gr = Array.isArray(gi.goods_receipts)
        ? gi.goods_receipts[0]
        : gi.goods_receipts;
      rows.push({
        stage: 'goods_receipt',
        supplier_id: supplierId,
        item_id: gi.item_id,
        variant_id: gi.variant_id,
        price: gi.unit_cost,
        quantity: gi.quantity_received ?? null,
        document_id: gi.goods_receipt_id,
        warehouse_id: gr?.warehouse_id ?? null,
        date: gr?.received_at ?? gi.created_at,
        source_reference: {
          goods_receipt_item_id: gi.id,
          purchase_order_item_id: gi.purchase_order_item_id,
          receipt_number: gr?.receipt_number ?? null,
          receipt_status: gr?.status ?? null,
        },
      });
    }

    // Latest first, per the approved ordering requirement.
    rows.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    return rows;
  }
}
