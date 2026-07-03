-- =============================================================================
-- 039 — PAGINATE GOODS RECEIPTS RPC FUNCTION
-- Migration 036 added p_limit / p_offset to fn_purchase_orders_list_enriched,
-- fn_stock_transfers_list_enriched, and fn_stock_counts_list_enriched, but
-- missed the fourth sibling function from migration 034:
-- fn_goods_receipts_list_enriched. This was the last unpaginated Inventory/
-- Purchasing list endpoint (GET /purchasing/goods-receipts).
-- Default limit is 50 rows; maximum the app ever sends is 100.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_goods_receipts_list_enriched(
  p_tenant_id UUID,
  p_status    TEXT    DEFAULT NULL,
  p_limit     INT     DEFAULT 50,
  p_offset    INT     DEFAULT 0
)
RETURNS TABLE (
  id                    UUID,
  receipt_number        TEXT,
  warehouse_id          UUID,
  warehouse_name        TEXT,
  warehouse_code        TEXT,
  purchase_order_id     UUID,
  purchase_order_number TEXT,
  supplier_id           UUID,
  supplier_name         TEXT,
  status                TEXT,
  items_count           BIGINT,
  created_at            TIMESTAMPTZ
) AS $$
  SELECT
    gr.id,
    gr.receipt_number,
    gr.warehouse_id,
    w.name,
    w.code,
    gr.purchase_order_id,
    po.order_number,
    po.supplier_id,
    s.name,
    gr.status,
    COUNT(gri.id),
    gr.created_at
  FROM goods_receipts gr
  JOIN warehouses w ON w.id = gr.warehouse_id
  LEFT JOIN purchase_orders po ON po.id = gr.purchase_order_id
  LEFT JOIN suppliers s ON s.id = po.supplier_id
  LEFT JOIN goods_receipt_items gri ON gri.goods_receipt_id = gr.id
  WHERE gr.tenant_id = p_tenant_id
    AND (p_status IS NULL OR gr.status = p_status)
  GROUP BY gr.id, w.name, w.code, po.order_number, po.supplier_id, s.name
  ORDER BY gr.created_at DESC
  LIMIT  GREATEST(1, LEAST(p_limit, 100))
  OFFSET GREATEST(0, p_offset);
$$ LANGUAGE sql STABLE;
