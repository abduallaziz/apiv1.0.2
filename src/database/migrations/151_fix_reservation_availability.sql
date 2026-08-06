-- Migration 13.6-fix — Inventory Rules correction #1.
-- fn_create_reservation's availability check only subtracted quantity_reserved,
-- not quantity_damaged/quantity_expired — inconsistent with the availability
-- formula used everywhere else (fn_apply_stock_movement, v_stock_balance),
-- meaning damaged/expired stock could be reserved. Only the availability
-- calculation changes; reservation workflow, tables, stock_levels schema,
-- fn_apply_stock_movement, and costing are all untouched.
CREATE OR REPLACE FUNCTION fn_create_reservation(
  p_tenant_id      UUID,
  p_warehouse_id   UUID,
  p_item_id        UUID,
  p_variant_id     UUID,
  p_batch_id       UUID,
  p_quantity       NUMERIC,
  p_reference_type TEXT,
  p_reference_id   UUID,
  p_created_by     UUID,
  p_expires_at     TIMESTAMPTZ
) RETURNS stock_reservations AS $$
DECLARE
  v_level stock_levels;
  v_available NUMERIC;
  v_reservation stock_reservations;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive';
  END IF;

  v_level := _lock_or_create_stock_level(p_tenant_id, p_warehouse_id, NULL, p_item_id, p_variant_id, p_batch_id);
  v_available := v_level.quantity_on_hand - v_level.quantity_reserved - v_level.quantity_damaged - v_level.quantity_expired;

  IF v_available < p_quantity THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: available % requested % (item=% warehouse=%)',
      v_available, p_quantity, p_item_id, p_warehouse_id;
  END IF;

  UPDATE stock_levels
     SET quantity_reserved = quantity_reserved + p_quantity,
         version = version + 1,
         updated_at = NOW()
   WHERE id = v_level.id;

  INSERT INTO stock_reservations (
    tenant_id, warehouse_id, item_id, variant_id, batch_id, quantity,
    reference_type, reference_id, created_by, expires_at
  ) VALUES (
    p_tenant_id, p_warehouse_id, p_item_id, p_variant_id, p_batch_id, p_quantity,
    p_reference_type, p_reference_id, p_created_by, p_expires_at
  ) RETURNING * INTO v_reservation;

  PERFORM _emit_domain_event(
    p_tenant_id, 'inventory.reservation.created', 'stock_reservation', v_reservation.id,
    jsonb_build_object('item_id', p_item_id, 'warehouse_id', p_warehouse_id, 'quantity', p_quantity,
                        'reference_type', p_reference_type, 'reference_id', p_reference_id)
  );

  RETURN v_reservation;
END;
$$ LANGUAGE plpgsql;
