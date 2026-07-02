-- =============================================================================
-- 034. LIST-ENRICHMENT FUNCTIONS FOR PURCHASE ORDERS, GOODS RECEIPTS,
-- TRANSFERS AND STOCK COUNTS
-- The Inventory list pages need per-row aggregates (item counts, order
-- value, completion %, variance counts) that plain PostgREST embedded
-- selects cannot compute. Mirrors the fn_inventory_stock_levels_enriched
-- approach: one STABLE SQL function per resource, computed server-side.
-- =============================================================================

CREATE FUNCTION fn_purchase_orders_list_enriched(
  p_tenant_id UUID,
  p_status    TEXT DEFAULT NULL
)
RETURNS TABLE (
  id                  UUID,
  order_number        TEXT,
  supplier_id         UUID,
  supplier_name       TEXT,
  warehouse_id        UUID,
  warehouse_name      TEXT,
  warehouse_code      TEXT,
  order_date          TIMESTAMPTZ,
  expected_date       TIMESTAMPTZ,
  notes               TEXT,
  status              TEXT,
  items_count         BIGINT,
  quantity_ordered    NUMERIC,
  quantity_received   NUMERIC,
  total_value         NUMERIC,
  completion_pct      NUMERIC,
  created_at          TIMESTAMPTZ
) AS $$
  SELECT
    po.id,
    po.order_number,
    po.supplier_id,
    s.name,
    po.warehouse_id,
    w.name,
    w.code,
    po.order_date,
    po.expected_date,
    po.notes,
    po.status,
    COUNT(poi.id),
    COALESCE(SUM(poi.quantity_ordered), 0),
    COALESCE(SUM(poi.quantity_received), 0),
    COALESCE(SUM(poi.quantity_ordered * poi.unit_cost), 0),
    CASE
      WHEN COALESCE(SUM(poi.quantity_ordered), 0) = 0 THEN 0
      ELSE ROUND(SUM(poi.quantity_received) / SUM(poi.quantity_ordered) * 100, 1)
    END,
    po.created_at
  FROM purchase_orders po
  JOIN suppliers s ON s.id = po.supplier_id
  JOIN warehouses w ON w.id = po.warehouse_id
  LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
  WHERE po.tenant_id = p_tenant_id
    AND po.deleted_at IS NULL
    AND (p_status IS NULL OR po.status = p_status)
  GROUP BY po.id, s.name, w.name, w.code
  ORDER BY po.created_at DESC;
$$ LANGUAGE sql STABLE;

CREATE FUNCTION fn_goods_receipts_list_enriched(
  p_tenant_id UUID,
  p_status    TEXT DEFAULT NULL
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
  ORDER BY gr.created_at DESC;
$$ LANGUAGE sql STABLE;

CREATE FUNCTION fn_stock_transfers_list_enriched(
  p_tenant_id UUID,
  p_status    TEXT DEFAULT NULL
)
RETURNS TABLE (
  id                    UUID,
  transfer_number       TEXT,
  from_warehouse_id     UUID,
  from_warehouse_name   TEXT,
  from_warehouse_code   TEXT,
  to_warehouse_id       UUID,
  to_warehouse_name     TEXT,
  to_warehouse_code     TEXT,
  status                TEXT,
  items_count           BIGINT,
  dispatched_at         TIMESTAMPTZ,
  received_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ
) AS $$
  SELECT
    st.id,
    st.transfer_number,
    st.from_warehouse_id,
    fw.name,
    fw.code,
    st.to_warehouse_id,
    tw.name,
    tw.code,
    st.status,
    COUNT(sti.id),
    st.dispatched_at,
    st.received_at,
    st.created_at
  FROM stock_transfers st
  JOIN warehouses fw ON fw.id = st.from_warehouse_id
  JOIN warehouses tw ON tw.id = st.to_warehouse_id
  LEFT JOIN stock_transfer_items sti ON sti.stock_transfer_id = st.id
  WHERE st.tenant_id = p_tenant_id
    AND (p_status IS NULL OR st.status = p_status)
  GROUP BY st.id, fw.name, fw.code, tw.name, tw.code
  ORDER BY st.created_at DESC;
$$ LANGUAGE sql STABLE;

CREATE FUNCTION fn_stock_counts_list_enriched(
  p_tenant_id UUID,
  p_status    TEXT DEFAULT NULL
)
RETURNS TABLE (
  id                    UUID,
  count_number          TEXT,
  warehouse_id          UUID,
  warehouse_name        TEXT,
  warehouse_code        TEXT,
  status                TEXT,
  items_count           BIGINT,
  items_counted         BIGINT,
  items_with_variance   BIGINT,
  net_variance_quantity NUMERIC,
  created_at            TIMESTAMPTZ
) AS $$
  SELECT
    sc.id,
    sc.count_number,
    sc.warehouse_id,
    w.name,
    w.code,
    sc.status,
    COUNT(sci.id),
    COUNT(sci.id) FILTER (WHERE sci.counted_quantity IS NOT NULL),
    COUNT(sci.id) FILTER (WHERE sci.counted_quantity IS NOT NULL AND sci.counted_quantity <> sci.expected_quantity),
    COALESCE(SUM(COALESCE(sci.counted_quantity, sci.expected_quantity) - sci.expected_quantity), 0),
    sc.created_at
  FROM stock_counts sc
  JOIN warehouses w ON w.id = sc.warehouse_id
  LEFT JOIN stock_count_items sci ON sci.stock_count_id = sc.id
  WHERE sc.tenant_id = p_tenant_id
    AND (p_status IS NULL OR sc.status = p_status)
  GROUP BY sc.id, w.name, w.code
  ORDER BY sc.created_at DESC;
$$ LANGUAGE sql STABLE;
