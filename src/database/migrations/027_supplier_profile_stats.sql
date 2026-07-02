-- =============================================================================
-- 027. SUPPLIER PROFILE STATS — read-only aggregate for the supplier detail
-- view (outstanding POs, last purchase date, avg lead time, total purchases,
-- inventory value purchased, open receipts). Sits alongside 024/025/026
-- outside the atomicity-boundary RPC layer (019); pure SELECTs, no side
-- effects.
-- =============================================================================

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

    (SELECT AVG(EXTRACT(EPOCH FROM (gr.received_at - po.order_date)) / 86400.0)
       FROM goods_receipts gr
       JOIN purchase_orders po ON po.id = gr.purchase_order_id
       WHERE gr.tenant_id = p_tenant_id AND po.supplier_id = p_supplier_id
         AND gr.status = 'posted' AND gr.received_at IS NOT NULL) AS avg_lead_time_days;
$$;
