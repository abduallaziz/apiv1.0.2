-- =============================================================================
-- 096 — fn_apply_stock_movement: record before/after quantity snapshots
-- =============================================================================
-- CREATE OR REPLACE with the IDENTICAL signature (same 14 params, same order,
-- same defaults, same return type). Every existing caller (sales, purchases,
-- transfers, adjustments, counts, legacy migration backfill) passes the same
-- arguments as before and gets the same behavior — insufficient-stock guard,
-- available-quantity calculation, stock_levels creation/locking, and the
-- domain event are all untouched. The only addition: v_before/v_after locals
-- capture quantity_on_hand immediately before and after the UPDATE, written
-- into the two nullable columns added in migration 094.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_apply_stock_movement(
  p_tenant_id      UUID,
  p_warehouse_id   UUID,
  p_location_id    UUID,
  p_item_id        UUID,
  p_variant_id     UUID,
  p_batch_id       UUID,
  p_movement_type  TEXT,
  p_direction      TEXT,
  p_quantity       NUMERIC,
  p_unit_cost      NUMERIC,
  p_reference_type TEXT,
  p_reference_id   UUID,
  p_created_by     UUID,
  p_allow_negative BOOLEAN DEFAULT false
) RETURNS stock_movements AS $$
DECLARE
  v_level     stock_levels;
  v_movement  stock_movements;
  v_available NUMERIC;
  v_before    NUMERIC;
  v_after     NUMERIC;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive, got %', p_quantity;
  END IF;

  v_level := _lock_or_create_stock_level(p_tenant_id, p_warehouse_id, p_location_id, p_item_id, p_variant_id, p_batch_id);
  v_before := v_level.quantity_on_hand;

  IF p_direction = 'out' THEN
    v_available := v_level.quantity_on_hand - v_level.quantity_reserved;
    IF NOT p_allow_negative AND v_available < p_quantity THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: available % requested % (item=% warehouse=%)',
        v_available, p_quantity, p_item_id, p_warehouse_id;
    END IF;
    UPDATE stock_levels
       SET quantity_on_hand = quantity_on_hand - p_quantity,
           version = version + 1,
           updated_at = NOW()
     WHERE id = v_level.id
     RETURNING quantity_on_hand INTO v_after;
  ELSIF p_direction = 'in' THEN
    UPDATE stock_levels
       SET quantity_on_hand = quantity_on_hand + p_quantity,
           version = version + 1,
           updated_at = NOW()
     WHERE id = v_level.id
     RETURNING quantity_on_hand INTO v_after;
  ELSE
    RAISE EXCEPTION 'invalid direction %', p_direction;
  END IF;

  INSERT INTO stock_movements (
    tenant_id, warehouse_id, location_id, item_id, variant_id, batch_id,
    movement_type, direction, quantity, unit_cost, total_cost,
    before_quantity, after_quantity,
    reference_type, reference_id, created_by
  ) VALUES (
    p_tenant_id, p_warehouse_id, p_location_id, p_item_id, p_variant_id, p_batch_id,
    p_movement_type, p_direction, p_quantity, p_unit_cost, p_quantity * p_unit_cost,
    v_before, v_after,
    p_reference_type, p_reference_id, p_created_by
  ) RETURNING * INTO v_movement;

  PERFORM _emit_domain_event(
    p_tenant_id, 'inventory.stock_movement.recorded', 'stock_movement', v_movement.id,
    jsonb_build_object(
      'movement_type', p_movement_type, 'direction', p_direction, 'quantity', p_quantity,
      'unit_cost', p_unit_cost, 'item_id', p_item_id, 'variant_id', p_variant_id,
      'warehouse_id', p_warehouse_id, 'reference_type', p_reference_type, 'reference_id', p_reference_id
    )
  );

  RETURN v_movement;
END;
$$ LANGUAGE plpgsql;
