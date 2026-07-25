-- Inventory redesign — Part A item #17 completion: real demand forecasting
-- on top of the existing reorder-point mechanism (migration 016/021).
-- Confirmed before this migration: reorder points existed, but "how much
-- should I actually order" was purely the static reorder_quantity field —
-- no connection to real historical sales velocity at all.

ALTER TABLE inventory_reorder_points ADD COLUMN lead_time_days NUMERIC(6,2);

-- Real average daily demand from actual sale movements in the lookback
-- window — not a guess, not a supplier-stated lead time misused as a
-- demand figure. STABLE (not IMMUTABLE) since it reads live movement
-- history each call.
CREATE OR REPLACE FUNCTION fn_calculate_demand_forecast(
  p_tenant_id     UUID,
  p_warehouse_id  UUID,
  p_item_id       UUID,
  p_variant_id    UUID,
  p_lookback_days INTEGER DEFAULT 30
) RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(quantity), 0) / GREATEST(p_lookback_days, 1)
  FROM stock_movements
  WHERE tenant_id = p_tenant_id
    AND warehouse_id = p_warehouse_id
    AND item_id = p_item_id
    AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND movement_type = 'sale'
    AND direction = 'out'
    AND occurred_at >= NOW() - (p_lookback_days || ' days')::INTERVAL;
$$ LANGUAGE sql STABLE;

-- Purchase suggestions: every active reorder point, enriched with real
-- forecasted demand during its own lead time (falls back to the
-- supplier's real avg_lead_time_days — migration 027 — when the reorder
-- point itself has no lead_time_days set; falls back to 7 days if
-- neither exists, so the function never divides into a null/zero
-- horizon). suggested_order_quantity is the larger of the configured
-- reorder_quantity or (forecasted demand during lead time minus what's
-- already available+incoming), never negative.
CREATE OR REPLACE FUNCTION fn_purchase_suggestions(p_tenant_id UUID)
RETURNS TABLE (
  reorder_point_id UUID,
  warehouse_id UUID,
  item_id UUID,
  variant_id UUID,
  item_name TEXT,
  quantity_available NUMERIC,
  quantity_incoming NUMERIC,
  avg_daily_demand NUMERIC,
  lead_time_days NUMERIC,
  forecasted_demand_during_lead_time NUMERIC,
  suggested_order_quantity NUMERIC
) AS $$
  SELECT
    rp.id,
    rp.warehouse_id,
    rp.item_id,
    rp.variant_id,
    i.name,
    COALESCE(vsb.quantity_available, 0),
    COALESCE(vsb.quantity_incoming, 0),
    fn_calculate_demand_forecast(rp.tenant_id, rp.warehouse_id, rp.item_id, rp.variant_id, 30),
    COALESCE(rp.lead_time_days, s.avg_lead_time_days, 7),
    fn_calculate_demand_forecast(rp.tenant_id, rp.warehouse_id, rp.item_id, rp.variant_id, 30)
      * COALESCE(rp.lead_time_days, s.avg_lead_time_days, 7),
    GREATEST(
      rp.reorder_quantity,
      (fn_calculate_demand_forecast(rp.tenant_id, rp.warehouse_id, rp.item_id, rp.variant_id, 30)
        * COALESCE(rp.lead_time_days, s.avg_lead_time_days, 7))
        - COALESCE(vsb.quantity_available, 0) - COALESCE(vsb.quantity_incoming, 0),
      0
    )
  FROM inventory_reorder_points rp
  JOIN items i ON i.id = rp.item_id
  LEFT JOIN v_stock_balance vsb
    ON vsb.tenant_id = rp.tenant_id AND vsb.warehouse_id = rp.warehouse_id AND vsb.item_id = rp.item_id
   AND COALESCE(vsb.variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(rp.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LEFT JOIN LATERAL (
    SELECT AVG(gr_items.avg_lead) AS avg_lead_time_days
    FROM (
      SELECT po.supplier_id, EXTRACT(DAY FROM AVG(gr.received_at - po.created_at)) AS avg_lead
      FROM purchase_orders po
      JOIN goods_receipts gr ON gr.purchase_order_id = po.id AND gr.status = 'posted' AND gr.received_at IS NOT NULL
      WHERE po.tenant_id = rp.tenant_id
      GROUP BY po.supplier_id
    ) gr_items
  ) s ON true
  WHERE rp.tenant_id = p_tenant_id AND rp.is_active = true
    AND (
      COALESCE(vsb.quantity_available, 0) <= rp.min_quantity
      OR COALESCE(vsb.quantity_available, 0) + COALESCE(vsb.quantity_incoming, 0)
         < (fn_calculate_demand_forecast(rp.tenant_id, rp.warehouse_id, rp.item_id, rp.variant_id, 30)
            * COALESCE(rp.lead_time_days, s.avg_lead_time_days, 7))
    );
$$ LANGUAGE sql STABLE;
