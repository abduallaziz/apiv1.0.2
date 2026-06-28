-- =============================================================================
-- 026. INVENTORY MOVEMENTS LEDGER
-- Read-only paginated ledger backing the Inventory Movements page: joins
-- product/warehouse/location/batch/user names and computes a running balance
-- per (item, variant, warehouse) via window function. STABLE, no mutation —
-- sits alongside 024/025 outside the atomicity-boundary RPC layer (019).
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_inventory_movements_ledger(
  p_tenant_id      UUID,
  p_warehouse_id   UUID DEFAULT NULL,
  p_item_id        UUID DEFAULT NULL,
  p_movement_type  TEXT DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id   UUID DEFAULT NULL,
  p_created_by     UUID DEFAULT NULL,
  p_date_from      TIMESTAMPTZ DEFAULT NULL,
  p_date_to        TIMESTAMPTZ DEFAULT NULL,
  p_limit          INT DEFAULT 50,
  p_offset         INT DEFAULT 0
)
RETURNS TABLE (
  id              UUID,
  occurred_at     TIMESTAMPTZ,
  movement_type   TEXT,
  direction       TEXT,
  reference_type  TEXT,
  reference_id    UUID,
  item_id         UUID,
  variant_id      UUID,
  item_name       TEXT,
  item_sku        TEXT,
  variant_name    TEXT,
  warehouse_id    UUID,
  warehouse_name  TEXT,
  location_id     UUID,
  location_name   TEXT,
  batch_id        UUID,
  batch_number    TEXT,
  quantity        NUMERIC,
  unit_cost       NUMERIC,
  total_cost      NUMERIC,
  running_balance  NUMERIC,
  created_by      UUID,
  performed_by    TEXT,
  total_count     BIGINT
) AS $$
  WITH filtered AS (
    SELECT sm.*
      FROM stock_movements sm
     WHERE sm.tenant_id = p_tenant_id
       AND (p_warehouse_id IS NULL OR sm.warehouse_id = p_warehouse_id)
       AND (p_item_id IS NULL OR sm.item_id = p_item_id)
       AND (p_movement_type IS NULL OR sm.movement_type = p_movement_type)
       AND (p_reference_type IS NULL OR sm.reference_type = p_reference_type)
       AND (p_reference_id IS NULL OR sm.reference_id = p_reference_id)
       AND (p_created_by IS NULL OR sm.created_by = p_created_by)
       AND (p_date_from IS NULL OR sm.occurred_at >= p_date_from)
       AND (p_date_to IS NULL OR sm.occurred_at <= p_date_to)
  ),
  with_balance AS (
    SELECT
      f.*,
      SUM(CASE WHEN f.direction = 'in' THEN f.quantity ELSE -f.quantity END)
        OVER (PARTITION BY f.item_id, f.variant_id, f.warehouse_id ORDER BY f.occurred_at, f.id) AS running_balance,
      COUNT(*) OVER () AS total_count
    FROM filtered f
  )
  SELECT
    wb.id,
    wb.occurred_at,
    wb.movement_type,
    wb.direction,
    wb.reference_type,
    wb.reference_id,
    wb.item_id,
    wb.variant_id,
    i.name,
    i.sku,
    iv.name,
    wb.warehouse_id,
    w.name,
    wb.location_id,
    wl.name,
    wb.batch_id,
    ib.batch_number,
    wb.quantity,
    wb.unit_cost,
    wb.total_cost,
    wb.running_balance,
    wb.created_by,
    u.name,
    wb.total_count
  FROM with_balance wb
  JOIN items i ON i.id = wb.item_id
  JOIN warehouses w ON w.id = wb.warehouse_id
  LEFT JOIN item_variants iv ON iv.id = wb.variant_id
  LEFT JOIN warehouse_locations wl ON wl.id = wb.location_id
  LEFT JOIN item_batches ib ON ib.id = wb.batch_id
  LEFT JOIN users u ON u.id = wb.created_by
  ORDER BY wb.occurred_at DESC, wb.id DESC
  LIMIT p_limit OFFSET p_offset;
$$ LANGUAGE sql STABLE;
