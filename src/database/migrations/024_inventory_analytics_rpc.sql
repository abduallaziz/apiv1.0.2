-- =============================================================================
-- 024. INVENTORY ANALYTICS RPC
-- Read-only aggregate function backing the Inventory Dashboard. Pure SELECTs
-- over existing Inventory/Purchasing tables — no mutation, so it sits outside
-- the atomicity-boundary RPC layer (019) by design; STABLE, not VOLATILE.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_inventory_dashboard_summary(p_tenant_id UUID)
RETURNS JSON AS $$
DECLARE
  v_inventory_value     NUMERIC;
  v_total_warehouses     BIGINT;
  v_products_in_stock    BIGINT;
  v_low_stock_items      BIGINT;
  v_out_of_stock_items   BIGINT;
  v_reserved_stock       NUMERIC;
  v_pending_pos          BIGINT;
  v_pending_receipts     BIGINT;
  v_movements_today      BIGINT;
  v_adjustments_today    BIGINT;
BEGIN
  SELECT COALESCE(SUM(cl.quantity_remaining * cl.unit_cost), 0)
    INTO v_inventory_value
    FROM cost_layers cl
   WHERE cl.tenant_id = p_tenant_id
     AND cl.quantity_remaining > 0;

  SELECT COUNT(*) INTO v_total_warehouses
    FROM warehouses w
   WHERE w.tenant_id = p_tenant_id AND w.deleted_at IS NULL AND w.is_active = true;

  SELECT COUNT(*) INTO v_products_in_stock
    FROM stock_levels sl
   WHERE sl.tenant_id = p_tenant_id AND sl.quantity_on_hand > 0;

  SELECT COUNT(*) INTO v_out_of_stock_items
    FROM inventory_reorder_points rp
   WHERE rp.tenant_id = p_tenant_id AND rp.is_active = true
     AND NOT EXISTS (
       SELECT 1 FROM stock_levels sl
        WHERE sl.tenant_id = rp.tenant_id
          AND sl.warehouse_id = rp.warehouse_id
          AND sl.item_id = rp.item_id
          AND COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = COALESCE(rp.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          AND sl.quantity_on_hand > 0
     );

  SELECT COUNT(*) INTO v_low_stock_items
    FROM inventory_reorder_points rp
    JOIN stock_levels sl
      ON sl.tenant_id = rp.tenant_id
     AND sl.warehouse_id = rp.warehouse_id
     AND sl.item_id = rp.item_id
     AND COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(rp.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
   WHERE rp.tenant_id = p_tenant_id AND rp.is_active = true
     AND sl.quantity_on_hand > 0
     AND sl.quantity_on_hand <= rp.min_quantity;

  SELECT COALESCE(SUM(sl.quantity_reserved), 0) INTO v_reserved_stock
    FROM stock_levels sl
   WHERE sl.tenant_id = p_tenant_id;

  SELECT COUNT(*) INTO v_pending_pos
    FROM purchase_orders po
   WHERE po.tenant_id = p_tenant_id AND po.deleted_at IS NULL
     AND po.status IN ('submitted', 'approved', 'partially_received');

  SELECT COUNT(*) INTO v_pending_receipts
    FROM goods_receipts gr
   WHERE gr.tenant_id = p_tenant_id AND gr.status = 'draft';

  SELECT COUNT(*) INTO v_movements_today
    FROM stock_movements sm
   WHERE sm.tenant_id = p_tenant_id
     AND sm.occurred_at >= date_trunc('day', NOW());

  SELECT COUNT(*) INTO v_adjustments_today
    FROM stock_adjustments sa
   WHERE sa.tenant_id = p_tenant_id
     AND sa.created_at >= date_trunc('day', NOW());

  RETURN json_build_object(
    'inventory_value', v_inventory_value,
    'total_warehouses', v_total_warehouses,
    'products_in_stock', v_products_in_stock,
    'low_stock_items', v_low_stock_items,
    'out_of_stock_items', v_out_of_stock_items,
    'reserved_stock', v_reserved_stock,
    'pending_purchase_orders', v_pending_pos,
    'pending_goods_receipts', v_pending_receipts,
    'movements_today', v_movements_today,
    'adjustments_today', v_adjustments_today
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Low-stock / out-of-stock alert rows: reorder points whose current on-hand
-- quantity has crossed into or below the minimum threshold.
CREATE OR REPLACE FUNCTION fn_inventory_low_stock_list(p_tenant_id UUID, p_limit INT DEFAULT 10)
RETURNS TABLE (
  item_id        UUID,
  variant_id     UUID,
  warehouse_id   UUID,
  item_name      TEXT,
  variant_name   TEXT,
  warehouse_name TEXT,
  quantity_on_hand NUMERIC,
  min_quantity   NUMERIC,
  reorder_quantity NUMERIC,
  status         TEXT
) AS $$
  SELECT
    rp.item_id,
    rp.variant_id,
    rp.warehouse_id,
    i.name,
    iv.name,
    w.name,
    COALESCE(sl.quantity_on_hand, 0),
    rp.min_quantity,
    rp.reorder_quantity,
    CASE WHEN COALESCE(sl.quantity_on_hand, 0) = 0 THEN 'out_of_stock' ELSE 'low_stock' END
  FROM inventory_reorder_points rp
  JOIN items i ON i.id = rp.item_id
  JOIN warehouses w ON w.id = rp.warehouse_id
  LEFT JOIN item_variants iv ON iv.id = rp.variant_id
  LEFT JOIN stock_levels sl
    ON sl.tenant_id = rp.tenant_id
   AND sl.warehouse_id = rp.warehouse_id
   AND sl.item_id = rp.item_id
   AND COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(rp.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  WHERE rp.tenant_id = p_tenant_id
    AND rp.is_active = true
    AND COALESCE(sl.quantity_on_hand, 0) <= rp.min_quantity
  ORDER BY COALESCE(sl.quantity_on_hand, 0) ASC
  LIMIT p_limit;
$$ LANGUAGE sql STABLE;

-- Per-warehouse summary card data (name, location count, on-hand value, active state).
CREATE OR REPLACE FUNCTION fn_inventory_warehouse_summary(p_tenant_id UUID)
RETURNS TABLE (
  warehouse_id   UUID,
  code           TEXT,
  name           TEXT,
  is_active      BOOLEAN,
  location_count BIGINT,
  inventory_value NUMERIC
) AS $$
  SELECT
    w.id,
    w.code,
    w.name,
    w.is_active,
    (SELECT COUNT(*) FROM warehouse_locations wl
      WHERE wl.warehouse_id = w.id AND wl.deleted_at IS NULL) AS location_count,
    COALESCE((SELECT SUM(cl.quantity_remaining * cl.unit_cost) FROM cost_layers cl
      WHERE cl.warehouse_id = w.id AND cl.quantity_remaining > 0), 0) AS inventory_value
  FROM warehouses w
  WHERE w.tenant_id = p_tenant_id AND w.deleted_at IS NULL
  ORDER BY w.created_at;
$$ LANGUAGE sql STABLE;
