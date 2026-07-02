-- =============================================================================
-- 021. INVENTORY REPORTING FUNCTIONS — read-only aggregations not expressible
-- through PostgREST's query builder (grouping stock_levels by reorder point).
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_items_below_reorder_point(p_tenant_id UUID)
RETURNS TABLE (
  reorder_point_id UUID,
  warehouse_id UUID,
  item_id UUID,
  variant_id UUID,
  item_name TEXT,
  min_quantity NUMERIC,
  reorder_quantity NUMERIC,
  quantity_on_hand NUMERIC
) AS $$
  SELECT
    rp.id,
    rp.warehouse_id,
    rp.item_id,
    rp.variant_id,
    i.name,
    rp.min_quantity,
    rp.reorder_quantity,
    COALESCE(SUM(sl.quantity_on_hand), 0) AS quantity_on_hand
  FROM inventory_reorder_points rp
  JOIN items i ON i.id = rp.item_id
  LEFT JOIN stock_levels sl
    ON sl.tenant_id = rp.tenant_id
   AND sl.warehouse_id = rp.warehouse_id
   AND sl.item_id = rp.item_id
   AND COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(rp.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  WHERE rp.tenant_id = p_tenant_id AND rp.is_active = true
  GROUP BY rp.id, rp.warehouse_id, rp.item_id, rp.variant_id, i.name, rp.min_quantity, rp.reorder_quantity
  HAVING COALESCE(SUM(sl.quantity_on_hand), 0) <= rp.min_quantity;
$$ LANGUAGE sql STABLE;
