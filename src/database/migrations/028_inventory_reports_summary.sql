-- =============================================================================
-- 028. INVENTORY REPORTS SUMMARY — read-only STABLE aggregates for the
-- Inventory Reports module, sitting alongside 021/024/025/026/027 outside the
-- atomicity-boundary RPC layer (019). Each function returns a single summary
-- row per status bucket so the frontend can render report cards/tables
-- without pulling full row sets across the wire.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_purchase_orders_summary(p_tenant_id UUID)
RETURNS TABLE (
  status TEXT,
  order_count BIGINT,
  total_value NUMERIC
) AS $$
  SELECT
    po.status,
    COUNT(DISTINCT po.id) AS order_count,
    COALESCE(SUM(poi.quantity_ordered * poi.unit_cost), 0) AS total_value
  FROM purchase_orders po
  LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
  WHERE po.tenant_id = p_tenant_id AND po.deleted_at IS NULL
  GROUP BY po.status;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_goods_receipts_summary(p_tenant_id UUID)
RETURNS TABLE (
  status TEXT,
  receipt_count BIGINT,
  total_value NUMERIC
) AS $$
  SELECT
    gr.status,
    COUNT(DISTINCT gr.id) AS receipt_count,
    COALESCE(SUM(gri.quantity_received * gri.unit_cost), 0) AS total_value
  FROM goods_receipts gr
  LEFT JOIN goods_receipt_items gri ON gri.goods_receipt_id = gr.id
  WHERE gr.tenant_id = p_tenant_id
  GROUP BY gr.status;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_adjustments_summary(p_tenant_id UUID)
RETURNS TABLE (
  status TEXT,
  adjustment_count BIGINT,
  net_quantity NUMERIC,
  net_value NUMERIC
) AS $$
  SELECT
    sa.status,
    COUNT(*) AS adjustment_count,
    COALESCE(SUM(sa.quantity_delta), 0) AS net_quantity,
    COALESCE(SUM(sa.quantity_delta * COALESCE(sa.unit_cost, 0)), 0) AS net_value
  FROM stock_adjustments sa
  WHERE sa.tenant_id = p_tenant_id
  GROUP BY sa.status;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_transfers_summary(p_tenant_id UUID)
RETURNS TABLE (
  status TEXT,
  transfer_count BIGINT
) AS $$
  SELECT
    st.status,
    COUNT(*) AS transfer_count
  FROM stock_transfers st
  WHERE st.tenant_id = p_tenant_id
  GROUP BY st.status;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_stock_counts_variance_summary(p_tenant_id UUID)
RETURNS TABLE (
  stock_count_id UUID,
  count_number TEXT,
  warehouse_id UUID,
  status TEXT,
  items_counted BIGINT,
  items_with_variance BIGINT,
  net_variance_quantity NUMERIC
) AS $$
  SELECT
    sc.id,
    sc.count_number,
    sc.warehouse_id,
    sc.status,
    COUNT(sci.id) FILTER (WHERE sci.counted_quantity IS NOT NULL) AS items_counted,
    COUNT(sci.id) FILTER (WHERE sci.counted_quantity IS NOT NULL AND sci.counted_quantity <> sci.expected_quantity) AS items_with_variance,
    COALESCE(SUM(COALESCE(sci.counted_quantity, sci.expected_quantity) - sci.expected_quantity), 0) AS net_variance_quantity
  FROM stock_counts sc
  LEFT JOIN stock_count_items sci ON sci.stock_count_id = sc.id
  WHERE sc.tenant_id = p_tenant_id
  GROUP BY sc.id, sc.count_number, sc.warehouse_id, sc.status
  ORDER BY sc.created_at DESC;
$$ LANGUAGE sql STABLE;
