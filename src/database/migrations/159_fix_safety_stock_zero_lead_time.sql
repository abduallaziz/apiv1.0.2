-- Fix for migration 158: fn_calculate_safety_stock collapsed to 0 whenever
-- the resolved lead time was legitimately 0 days (same-day receiving —
-- confirmed against real fixture data), because COALESCE(v_lead_time, 7)
-- only substitutes on NULL, not on 0, so SQRT(0) zeroed the whole formula
-- regardless of real demand variability. Floor lead time at 1 day instead.

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

  -- GREATEST, not COALESCE alone: a real 0-day (same-day) resolved lead time
  -- must not collapse SQRT() to zero and erase real demand variability.
  v_lead_time := GREATEST(COALESCE(v_lead_time, 7), 1);
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
