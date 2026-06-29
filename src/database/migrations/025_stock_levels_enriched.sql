-- =============================================================================
-- 025. ENRICHED STOCK LEVELS LISTING
-- Read-only aggregate function backing the Stock Levels page: joins location,
-- batch, reorder point, valuation and last-movement data onto each stock_levels
-- row in a single round trip. Pure SELECT, STABLE — sits alongside 024 outside
-- the atomicity-boundary RPC layer (019).
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_inventory_stock_levels_enriched(
  p_tenant_id    UUID,
  p_warehouse_id UUID DEFAULT NULL,
  p_item_id      UUID DEFAULT NULL,
  p_category_id  UUID DEFAULT NULL,
  p_location_id  UUID DEFAULT NULL,
  p_batch_id     UUID DEFAULT NULL,
  p_supplier_id  UUID DEFAULT NULL,
  p_status       TEXT DEFAULT NULL
)
RETURNS TABLE (
  stock_level_id    UUID,
  item_id            UUID,
  variant_id         UUID,
  warehouse_id       UUID,
  location_id        UUID,
  batch_id           UUID,
  item_name          TEXT,
  item_sku           TEXT,
  variant_name       TEXT,
  warehouse_name     TEXT,
  location_name      TEXT,
  batch_number       TEXT,
  quantity_on_hand   NUMERIC,
  quantity_reserved  NUMERIC,
  quantity_available NUMERIC,
  quantity_incoming  NUMERIC,
  reorder_min        NUMERIC,
  status             TEXT,
  inventory_value    NUMERIC,
  last_movement_at   TIMESTAMPTZ
) AS $$
  SELECT
    sl.id,
    sl.item_id,
    sl.variant_id,
    sl.warehouse_id,
    sl.location_id,
    sl.batch_id,
    i.name,
    i.sku,
    iv.name,
    w.name,
    wl.name,
    ib.batch_number,
    sl.quantity_on_hand,
    sl.quantity_reserved,
    (sl.quantity_on_hand - sl.quantity_reserved),
    COALESCE(incoming.qty, 0),
    rp.min_quantity,
    CASE
      WHEN sl.quantity_on_hand <= 0 THEN 'out_of_stock'
      WHEN rp.min_quantity IS NOT NULL AND sl.quantity_on_hand <= rp.min_quantity THEN 'low_stock'
      ELSE 'in_stock'
    END,
    COALESCE(val.value, 0),
    lm.last_movement_at
  FROM stock_levels sl
  JOIN items i ON i.id = sl.item_id
  JOIN warehouses w ON w.id = sl.warehouse_id
  LEFT JOIN item_variants iv ON iv.id = sl.variant_id
  LEFT JOIN warehouse_locations wl ON wl.id = sl.location_id
  LEFT JOIN item_batches ib ON ib.id = sl.batch_id
  LEFT JOIN inventory_reorder_points rp
    ON rp.tenant_id = sl.tenant_id
   AND rp.warehouse_id = sl.warehouse_id
   AND rp.item_id = sl.item_id
   AND COALESCE(rp.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
   AND rp.is_active = true
  LEFT JOIN LATERAL (
    SELECT SUM(cl.quantity_remaining * cl.unit_cost) AS value
      FROM cost_layers cl
     WHERE cl.tenant_id = sl.tenant_id
       AND cl.warehouse_id = sl.warehouse_id
       AND cl.item_id = sl.item_id
       AND COALESCE(cl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND COALESCE(cl.batch_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE(sl.batch_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND cl.quantity_remaining > 0
  ) val ON true
  LEFT JOIN LATERAL (
    SELECT MAX(sm.occurred_at) AS last_movement_at
      FROM stock_movements sm
     WHERE sm.tenant_id = sl.tenant_id
       AND sm.warehouse_id = sl.warehouse_id
       AND sm.item_id = sl.item_id
       AND COALESCE(sm.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) lm ON true
  LEFT JOIN LATERAL (
    SELECT SUM(poi.quantity_ordered - poi.quantity_received) AS qty
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.purchase_order_id
     WHERE po.tenant_id = sl.tenant_id
       AND po.warehouse_id = sl.warehouse_id
       AND po.deleted_at IS NULL
       AND po.status IN ('submitted', 'approved', 'partially_received')
       AND poi.item_id = sl.item_id
       AND COALESCE(poi.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) incoming ON true
  WHERE sl.tenant_id = p_tenant_id
    AND (p_warehouse_id IS NULL OR sl.warehouse_id = p_warehouse_id)
    AND (p_item_id IS NULL OR sl.item_id = p_item_id)
    AND (p_category_id IS NULL OR i.category_id = p_category_id)
    AND (p_location_id IS NULL OR sl.location_id = p_location_id)
    AND (p_batch_id IS NULL OR sl.batch_id = p_batch_id)
    AND (p_supplier_id IS NULL OR ib.supplier_id = p_supplier_id)
    AND (
      p_status IS NULL OR p_status = (
        CASE
          WHEN sl.quantity_on_hand <= 0 THEN 'out_of_stock'
          WHEN rp.min_quantity IS NOT NULL AND sl.quantity_on_hand <= rp.min_quantity THEN 'low_stock'
          ELSE 'in_stock'
        END
      )
    )
  ORDER BY i.name, w.name;
$$ LANGUAGE sql STABLE;
