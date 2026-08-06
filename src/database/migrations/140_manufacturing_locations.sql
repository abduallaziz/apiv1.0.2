-- Migration 5.1 — Manufacturing Location Integration (Database + RPC only).
--
-- Adds location precision to production orders without introducing any new
-- inventory primitives: fn_apply_stock_movement, stock_movements,
-- stock_levels, and warehouse_locations already support a location_id — see
-- stock_levels' uq_stock_levels_point index (017) and fn_apply_stock_movement's
-- p_location_id param (105). Manufacturing simply never populated it
-- (fn_post_production_order hardcoded NULL for both its calls, 112).
--
-- All three columns are nullable and ON DELETE SET NULL (matching
-- shipment_lines.location_id, not stock_movements/stock_levels' RESTRICT —
-- a production order is a plan/reference, not an immutable ledger row, so it
-- should degrade to warehouse-level rather than block location deletion).
--
-- cost_layers, costing logic (fn_consume_cost_layers/fn_add_cost_layer),
-- stock_movements schema, stock_levels schema, and WMS logic are
-- deliberately untouched — approved design scope is DB + RPC only.

ALTER TABLE production_orders
  ADD COLUMN source_location_id UUID REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  ADD COLUMN staging_location_id UUID REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  ADD COLUMN output_location_id UUID REFERENCES warehouse_locations(id) ON DELETE SET NULL;

-- fn_post_production_order (112) — same signature, only the two hardcoded
-- NULL location arguments become v_order.source_location_id /
-- v_order.output_location_id. staging_location_id is schema-only in this
-- migration (no RPC behavior yet — reserved for a future reservation-style
-- workflow if a real need for it appears; not built ahead of that need).
CREATE OR REPLACE FUNCTION fn_post_production_order(
  p_production_order_id UUID,
  p_actor_id             UUID,
  p_quantity_produced    NUMERIC DEFAULT NULL
) RETURNS production_orders AS $$
DECLARE
  v_order  production_orders;
  v_bom    bill_of_materials;
  v_line   RECORD;
  v_qty_needed NUMERIC;
  v_unit_cost  NUMERIC;
  v_total_component_cost NUMERIC := 0;
  v_output_unit_cost NUMERIC;
  v_movement stock_movements;
  v_actual_qty NUMERIC;
BEGIN
  SELECT * INTO v_order FROM production_orders WHERE id = p_production_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'production order % not found', p_production_order_id;
  END IF;
  IF v_order.status <> 'draft' THEN
    RAISE EXCEPTION 'production order % is not draft (status=%)', p_production_order_id, v_order.status;
  END IF;

  SELECT * INTO v_bom FROM bill_of_materials WHERE id = v_order.bom_id;
  v_actual_qty := COALESCE(p_quantity_produced, v_order.quantity_planned);

  FOR v_line IN SELECT * FROM bom_lines WHERE bom_id = v_order.bom_id LOOP
    v_qty_needed := v_line.quantity_per_unit * v_actual_qty * (1 + v_line.scrap_percentage / 100);

    v_unit_cost := fn_consume_cost_layers(
      v_order.tenant_id, v_order.warehouse_id, v_line.component_item_id, v_line.component_variant_id,
      v_qty_needed
    );

    v_movement := fn_apply_stock_movement(
      v_order.tenant_id, v_order.warehouse_id, v_order.source_location_id, v_line.component_item_id, v_line.component_variant_id, NULL,
      'production_consumption', 'out', v_qty_needed, v_unit_cost,
      'production_order', p_production_order_id, p_actor_id
    );

    v_total_component_cost := v_total_component_cost + (v_qty_needed * v_unit_cost);
  END LOOP;

  v_output_unit_cost := ROUND(v_total_component_cost / v_actual_qty, 4);

  v_movement := fn_apply_stock_movement(
    v_order.tenant_id, v_order.warehouse_id, v_order.output_location_id, v_bom.item_id, v_bom.variant_id, NULL,
    'production_receipt', 'in', v_actual_qty, v_output_unit_cost,
    'production_order', p_production_order_id, p_actor_id
  );

  PERFORM fn_add_cost_layer(
    v_order.tenant_id, v_order.warehouse_id, v_bom.item_id, v_bom.variant_id, NULL,
    v_actual_qty, v_output_unit_cost, v_movement.id
  );

  UPDATE production_orders
     SET status = 'completed',
         quantity_produced = v_actual_qty,
         started_at = COALESCE(started_at, NOW()),
         completed_at = NOW(),
         updated_at = NOW()
   WHERE id = p_production_order_id
   RETURNING * INTO v_order;

  PERFORM _emit_domain_event(
    v_order.tenant_id, 'inventory.production_order.completed', 'production_order', v_order.id,
    jsonb_build_object('bom_id', v_order.bom_id, 'quantity_produced', v_actual_qty, 'unit_cost', v_output_unit_cost)
  );

  RETURN v_order;
END;
$$ LANGUAGE plpgsql;
