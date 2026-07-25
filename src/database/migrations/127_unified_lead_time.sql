-- Purchasing #9.4: unify vendor lead time into ONE function, computed from
-- real historical (item, supplier) receiving data — never a generic
-- lead-time value stored on `suppliers` itself (confirmed in the audit:
-- no such column exists or is added here; mehla توريد تختلف من صنف لآخر).
--
-- Before this migration, two independent, slightly different formulas
-- existed: fn_supplier_profile_stats (027, uses po.order_date, supplier-
-- wide) and fn_purchase_suggestions (113, uses po.created_at, also
-- supplier-wide despite being called from an item-specific reorder
-- point). Both are replaced by calls to this single function, keyed by
-- (item, supplier) — with either argument optional so the same function
-- serves both real use cases: "this supplier's overall lead time" (item
-- omitted) and "this item's lead time regardless of supplier" (supplier
-- omitted, used when no specific supplier is known yet, e.g. a reorder
-- point).

CREATE OR REPLACE FUNCTION fn_supplier_item_lead_time(
  p_tenant_id   UUID,
  p_item_id     UUID DEFAULT NULL,
  p_supplier_id UUID DEFAULT NULL
) RETURNS NUMERIC AS $$
  SELECT AVG(EXTRACT(EPOCH FROM (gr.received_at - po.order_date)) / 86400.0)
  FROM goods_receipt_items gri
  JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
  JOIN purchase_orders po ON po.id = gr.purchase_order_id
  WHERE gr.tenant_id = p_tenant_id
    AND gr.status = 'posted' AND gr.received_at IS NOT NULL
    AND (p_item_id IS NULL OR gri.item_id = p_item_id)
    AND (p_supplier_id IS NULL OR po.supplier_id = p_supplier_id);
$$ LANGUAGE sql STABLE;

-- fn_supplier_profile_stats: same 2-param signature, same output columns
-- — only avg_lead_time_days's calculation changes to call the unified
-- function (supplier-wide: item omitted) instead of its own inline formula.
CREATE OR REPLACE FUNCTION fn_supplier_profile_stats(
  p_tenant_id   UUID,
  p_supplier_id UUID
)
RETURNS TABLE (
  outstanding_po_count   BIGINT,
  open_receipts_count    BIGINT,
  total_purchase_orders  BIGINT,
  total_purchases_value  NUMERIC,
  inventory_value_purchased NUMERIC,
  last_purchase_date     DATE,
  avg_lead_time_days     NUMERIC
)
LANGUAGE sql STABLE AS $$
  SELECT
    (SELECT COUNT(*) FROM purchase_orders po
       WHERE po.tenant_id = p_tenant_id AND po.supplier_id = p_supplier_id
         AND po.deleted_at IS NULL
         AND po.status IN ('submitted', 'approved', 'partially_received')) AS outstanding_po_count,

    (SELECT COUNT(*) FROM goods_receipts gr
       JOIN purchase_orders po ON po.id = gr.purchase_order_id
       WHERE gr.tenant_id = p_tenant_id AND po.supplier_id = p_supplier_id
         AND gr.status = 'draft') AS open_receipts_count,

    (SELECT COUNT(*) FROM purchase_orders po
       WHERE po.tenant_id = p_tenant_id AND po.supplier_id = p_supplier_id
         AND po.deleted_at IS NULL) AS total_purchase_orders,

    (SELECT COALESCE(SUM(poi.quantity_ordered * poi.unit_cost), 0)
       FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id = poi.purchase_order_id
       WHERE po.tenant_id = p_tenant_id AND po.supplier_id = p_supplier_id
         AND po.deleted_at IS NULL) AS total_purchases_value,

    (SELECT COALESCE(SUM(poi.quantity_received * poi.unit_cost), 0)
       FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id = poi.purchase_order_id
       WHERE po.tenant_id = p_tenant_id AND po.supplier_id = p_supplier_id
         AND po.deleted_at IS NULL) AS inventory_value_purchased,

    (SELECT MAX(po.order_date) FROM purchase_orders po
       WHERE po.tenant_id = p_tenant_id AND po.supplier_id = p_supplier_id
         AND po.deleted_at IS NULL) AS last_purchase_date,

    fn_supplier_item_lead_time(p_tenant_id, NULL, p_supplier_id) AS avg_lead_time_days;
$$;

-- fn_purchase_suggestions: same 1-param signature, same output columns —
-- the fallback lead-time source (used only when the reorder point has no
-- explicit lead_time_days configured) now calls the unified function
-- item-specific (no supplier known at the reorder-point level), instead
-- of the old supplier-wide LATERAL subquery.
CREATE OR REPLACE FUNCTION fn_purchase_suggestions(p_tenant_id UUID)
RETURNS TABLE (
  reorder_point_id UUID,
  warehouse_id UUID,
  item_id UUID,
  variant_id UUID,
  item_name TEXT,
  quantity_available NUMERIC,
  quantity_incoming NUMERIC,
  avg_daily_demand NUMERIC,
  lead_time_days NUMERIC,
  forecasted_demand_during_lead_time NUMERIC,
  suggested_order_quantity NUMERIC
) AS $$
  SELECT
    rp.id,
    rp.warehouse_id,
    rp.item_id,
    rp.variant_id,
    i.name,
    COALESCE(vsb.quantity_available, 0),
    COALESCE(vsb.quantity_incoming, 0),
    fn_calculate_demand_forecast(rp.tenant_id, rp.warehouse_id, rp.item_id, rp.variant_id, 30),
    COALESCE(rp.lead_time_days, fn_supplier_item_lead_time(rp.tenant_id, rp.item_id, NULL), 7),
    fn_calculate_demand_forecast(rp.tenant_id, rp.warehouse_id, rp.item_id, rp.variant_id, 30)
      * COALESCE(rp.lead_time_days, fn_supplier_item_lead_time(rp.tenant_id, rp.item_id, NULL), 7),
    GREATEST(
      rp.reorder_quantity,
      (fn_calculate_demand_forecast(rp.tenant_id, rp.warehouse_id, rp.item_id, rp.variant_id, 30)
        * COALESCE(rp.lead_time_days, fn_supplier_item_lead_time(rp.tenant_id, rp.item_id, NULL), 7))
        - COALESCE(vsb.quantity_available, 0) - COALESCE(vsb.quantity_incoming, 0),
      0
    )
  FROM inventory_reorder_points rp
  JOIN items i ON i.id = rp.item_id
  LEFT JOIN v_stock_balance vsb
    ON vsb.tenant_id = rp.tenant_id AND vsb.warehouse_id = rp.warehouse_id AND vsb.item_id = rp.item_id
   AND COALESCE(vsb.variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(rp.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  WHERE rp.tenant_id = p_tenant_id AND rp.is_active = true
    AND (
      COALESCE(vsb.quantity_available, 0) <= rp.min_quantity
      OR COALESCE(vsb.quantity_available, 0) + COALESCE(vsb.quantity_incoming, 0)
         < (fn_calculate_demand_forecast(rp.tenant_id, rp.warehouse_id, rp.item_id, rp.variant_id, 30)
            * COALESCE(rp.lead_time_days, fn_supplier_item_lead_time(rp.tenant_id, rp.item_id, NULL), 7))
    );
$$ LANGUAGE sql STABLE;
