-- Migration 13.17 Phase A — Safety Stock calculation
--
-- DESIGN DECISION (documented per api/CLAUDE.md architectural approval
-- protocol — not silently chosen):
--
--   safety_stock = service_level_z * stddev_daily_demand * sqrt(lead_time_days)
--
-- This is the standard inventory-theory "King's formula" simplification
-- (demand-variability-only variant — lead time itself is treated as fixed,
-- not stochastic, since we don't yet track per-PO lead time variance).
-- service_level_z is the Z-score for a target service level (95% -> 1.65,
-- the chosen default; 90% -> 1.28; 98% -> 2.05; 99% -> 2.33 — callers/UI
-- can offer these as presets).
--
-- inventory_reorder_points.min_quantity remains the existing MANUAL floor
-- and its behavior is completely unchanged by this migration — every
-- existing read/write of min_quantity, and fn_purchase_suggestions'
-- reliance on it, continues to work exactly as before. This migration is
-- purely additive: a new optional per-item Z-score override column and a
-- new calculation function that returns a *recommendation*. Nothing here
-- writes to min_quantity automatically — applying the recommendation is a
-- deliberate user action via the API added in this phase.

ALTER TABLE inventory_reorder_points
  ADD COLUMN service_level_z NUMERIC(4,2);

COMMENT ON COLUMN inventory_reorder_points.service_level_z IS
  'Optional per-item target-service-level Z-score for fn_calculate_safety_stock (e.g. 1.65 for 95%). NULL falls back to the global default (1.65) inside the function.';

-- Computes a recommended safety-stock quantity from real historical daily
-- demand variability (stock_movements, sale/out) and the item's lead time
-- (same resolution order as fn_purchase_suggestions: reorder point's own
-- lead_time_days, else the tenant's real average supplier lead time from
-- purchase_orders/goods_receipts, else a 7-day fallback so the function
-- never divides into a null horizon).
CREATE OR REPLACE FUNCTION fn_calculate_safety_stock(
  p_tenant_id     UUID,
  p_warehouse_id  UUID,
  p_item_id       UUID,
  p_variant_id    UUID,
  p_lookback_days INTEGER DEFAULT 90
) RETURNS NUMERIC AS $$
DECLARE
  v_z NUMERIC;
  v_lead_time NUMERIC;
  v_stddev NUMERIC;
BEGIN
  SELECT COALESCE(rp.service_level_z, 1.65), rp.lead_time_days
    INTO v_z, v_lead_time
  FROM inventory_reorder_points rp
  WHERE rp.tenant_id = p_tenant_id
    AND rp.warehouse_id = p_warehouse_id
    AND rp.item_id = p_item_id
    AND COALESCE(rp.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_lead_time IS NULL THEN
    SELECT AVG(gr_items.avg_lead) INTO v_lead_time
    FROM (
      SELECT po.supplier_id, EXTRACT(DAY FROM AVG(gr.received_at - po.created_at)) AS avg_lead
      FROM purchase_orders po
      JOIN goods_receipts gr ON gr.purchase_order_id = po.id AND gr.status = 'posted' AND gr.received_at IS NOT NULL
      WHERE po.tenant_id = p_tenant_id
      GROUP BY po.supplier_id
    ) gr_items;
  END IF;

  v_lead_time := COALESCE(v_lead_time, 7);
  v_z := COALESCE(v_z, 1.65);

  SELECT STDDEV_SAMP(daily.qty) INTO v_stddev
  FROM (
    SELECT d::date AS day,
      COALESCE((
        SELECT SUM(sm.quantity)
        FROM stock_movements sm
        WHERE sm.tenant_id = p_tenant_id
          AND sm.warehouse_id = p_warehouse_id
          AND sm.item_id = p_item_id
          AND COALESCE(sm.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          AND sm.movement_type = 'sale'
          AND sm.direction = 'out'
          AND sm.occurred_at::date = d::date
      ), 0) AS qty
    FROM generate_series(CURRENT_DATE - (p_lookback_days - 1), CURRENT_DATE, '1 day') AS d
  ) daily;

  RETURN GREATEST(ROUND(v_z * COALESCE(v_stddev, 0) * SQRT(v_lead_time), 2), 0);
END;
$$ LANGUAGE plpgsql STABLE;
