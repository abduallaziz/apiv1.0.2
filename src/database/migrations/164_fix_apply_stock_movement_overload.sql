-- Fix for migration 163: fn_apply_stock_movement has a newer 15-param
-- signature (p_allow_backorder, added migration 105) that 163 was unaware
-- of — CREATE OR REPLACE with the older 14-param signature created a
-- SECOND overload instead of replacing it (the exact documented "function
-- overload" gotcha), breaking every PostgREST RPC call with "could not
-- choose the best candidate function." Caught immediately via direct smoke
-- test against the real Supabase project, before any application code was
-- written against it.
--
-- Fix: drop the stale 14-param overload 163 created, then CREATE OR REPLACE
-- the correct 15-param signature — restoring migration 105's full backorder
-- logic byte-for-byte, with quality_hold/quality_release added the same way
-- damage/expiry were, and quantity_quality_held excluded from every
-- v_available calculation (the 'damage'/'expiry'/'quality_hold' branch AND
-- the normal/backorder 'out' branch).

DROP FUNCTION IF EXISTS fn_apply_stock_movement(
  UUID, UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, UUID, UUID, BOOLEAN
);

CREATE OR REPLACE FUNCTION fn_apply_stock_movement(
  p_tenant_id        UUID,
  p_warehouse_id     UUID,
  p_location_id      UUID,
  p_item_id          UUID,
  p_variant_id       UUID,
  p_batch_id         UUID,
  p_movement_type    TEXT,
  p_direction        TEXT,
  p_quantity         NUMERIC,
  p_unit_cost        NUMERIC,
  p_reference_type   TEXT,
  p_reference_id     UUID,
  p_created_by       UUID,
  p_allow_negative   BOOLEAN DEFAULT false,
  p_allow_backorder  BOOLEAN DEFAULT false
) RETURNS stock_movements AS $$
DECLARE
  v_level         stock_levels;
  v_movement      stock_movements;
  v_available     NUMERIC;
  v_before        NUMERIC;
  v_after         NUMERIC;
  v_deduct_qty    NUMERIC;
  v_backorder_qty NUMERIC;
  v_bo_remaining  NUMERIC;
  v_bo            RECORD;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive, got %', p_quantity;
  END IF;

  v_level := _lock_or_create_stock_level(p_tenant_id, p_warehouse_id, p_location_id, p_item_id, p_variant_id, p_batch_id);
  v_before := v_level.quantity_on_hand;

  IF p_movement_type IN ('damage', 'expiry', 'quality_hold') THEN
    v_available := v_level.quantity_on_hand - v_level.quantity_reserved
                   - v_level.quantity_damaged - v_level.quantity_expired - v_level.quantity_quality_held;
    IF NOT p_allow_negative AND v_available < p_quantity THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: available % requested % (item=% warehouse=%)',
        v_available, p_quantity, p_item_id, p_warehouse_id;
    END IF;

    IF p_movement_type = 'damage' THEN
      UPDATE stock_levels
         SET quantity_damaged = quantity_damaged + p_quantity,
             version = version + 1,
             updated_at = NOW()
       WHERE id = v_level.id
       RETURNING quantity_on_hand INTO v_after;
    ELSIF p_movement_type = 'expiry' THEN
      UPDATE stock_levels
         SET quantity_expired = quantity_expired + p_quantity,
             version = version + 1,
             updated_at = NOW()
       WHERE id = v_level.id
       RETURNING quantity_on_hand INTO v_after;
    ELSE
      UPDATE stock_levels
         SET quantity_quality_held = quantity_quality_held + p_quantity,
             version = version + 1,
             updated_at = NOW()
       WHERE id = v_level.id
       RETURNING quantity_on_hand INTO v_after;
    END IF;
    v_deduct_qty := p_quantity;
    v_backorder_qty := 0;

  ELSIF p_movement_type = 'quality_release' THEN
    -- Reverse of quality_hold. Guarded by the CHECK constraint
    -- (quantity_quality_held >= 0) rather than a manual availability
    -- check — releasing never needs an availability test, only enough
    -- currently-held quantity to release.
    IF v_level.quantity_quality_held < p_quantity THEN
      RAISE EXCEPTION 'INSUFFICIENT_HELD_QUANTITY: held % requested % (item=% warehouse=%)',
        v_level.quantity_quality_held, p_quantity, p_item_id, p_warehouse_id;
    END IF;
    UPDATE stock_levels
       SET quantity_quality_held = quantity_quality_held - p_quantity,
           version = version + 1,
           updated_at = NOW()
     WHERE id = v_level.id
     RETURNING quantity_on_hand INTO v_after;
    v_deduct_qty := p_quantity;
    v_backorder_qty := 0;

  ELSIF p_direction = 'out' THEN
    v_available := v_level.quantity_on_hand - v_level.quantity_reserved
                   - v_level.quantity_damaged - v_level.quantity_expired - v_level.quantity_quality_held;

    IF v_available >= p_quantity THEN
      -- Enough stock — completely normal path, identical to before.
      UPDATE stock_levels
         SET quantity_on_hand = quantity_on_hand - p_quantity,
             version = version + 1,
             updated_at = NOW()
       WHERE id = v_level.id
       RETURNING quantity_on_hand INTO v_after;
      v_deduct_qty := p_quantity;
      v_backorder_qty := 0;

    ELSIF p_allow_backorder THEN
      -- Partial fulfillment: take whatever is genuinely free, promise the
      -- rest via quantity_backorder + a backorders row tied to the order.
      v_deduct_qty := GREATEST(v_available, 0);
      v_backorder_qty := p_quantity - v_deduct_qty;

      UPDATE stock_levels
         SET quantity_on_hand = quantity_on_hand - v_deduct_qty,
             quantity_backorder = quantity_backorder + v_backorder_qty,
             version = version + 1,
             updated_at = NOW()
       WHERE id = v_level.id
       RETURNING quantity_on_hand INTO v_after;

      IF p_reference_type = 'order' THEN
        INSERT INTO backorders (tenant_id, warehouse_id, item_id, variant_id, order_id, quantity)
        VALUES (p_tenant_id, p_warehouse_id, p_item_id, p_variant_id, p_reference_id, v_backorder_qty);
      END IF;

    ELSIF NOT p_allow_negative THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: available % requested % (item=% warehouse=%)',
        v_available, p_quantity, p_item_id, p_warehouse_id;
    ELSE
      UPDATE stock_levels
         SET quantity_on_hand = quantity_on_hand - p_quantity,
             version = version + 1,
             updated_at = NOW()
       WHERE id = v_level.id
       RETURNING quantity_on_hand INTO v_after;
      v_deduct_qty := p_quantity;
      v_backorder_qty := 0;
    END IF;

  ELSIF p_direction = 'in' THEN
    UPDATE stock_levels
       SET quantity_on_hand = quantity_on_hand + p_quantity,
           version = version + 1,
           updated_at = NOW()
     WHERE id = v_level.id
     RETURNING quantity_on_hand INTO v_after;
    v_deduct_qty := p_quantity;

    -- New stock arriving: reduce quantity_backorder first, before it's
    -- treated as free-for-new-orders (per spec). Fulfills oldest open
    -- backorders rows first (FIFO), for the same item/variant/warehouse.
    IF v_level.quantity_backorder > 0 THEN
      v_bo_remaining := LEAST(p_quantity, v_level.quantity_backorder);

      UPDATE stock_levels
         SET quantity_backorder = quantity_backorder - v_bo_remaining
       WHERE id = v_level.id;

      FOR v_bo IN
        SELECT id, quantity, quantity_fulfilled
        FROM backorders
        WHERE tenant_id = p_tenant_id
          AND warehouse_id = p_warehouse_id
          AND item_id = p_item_id
          AND (variant_id = p_variant_id OR (variant_id IS NULL AND p_variant_id IS NULL))
          AND status IN ('open', 'partially_fulfilled')
        ORDER BY created_at ASC
        FOR UPDATE
      LOOP
        EXIT WHEN v_bo_remaining <= 0;
        DECLARE
          v_this_fulfill NUMERIC := LEAST(v_bo_remaining, v_bo.quantity - v_bo.quantity_fulfilled);
        BEGIN
          UPDATE backorders
             SET quantity_fulfilled = quantity_fulfilled + v_this_fulfill,
                 status = CASE WHEN quantity_fulfilled + v_this_fulfill >= quantity THEN 'fulfilled' ELSE 'partially_fulfilled' END,
                 fulfilled_at = CASE WHEN quantity_fulfilled + v_this_fulfill >= quantity THEN NOW() ELSE fulfilled_at END
           WHERE id = v_bo.id;
          v_bo_remaining := v_bo_remaining - v_this_fulfill;
        END;
      END LOOP;
    END IF;
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
    p_movement_type, p_direction, COALESCE(v_deduct_qty, p_quantity), p_unit_cost,
    COALESCE(v_deduct_qty, p_quantity) * p_unit_cost,
    v_before, v_after,
    p_reference_type, p_reference_id, p_created_by
  ) RETURNING * INTO v_movement;

  PERFORM _emit_domain_event(
    p_tenant_id, 'inventory.stock_movement.recorded', 'stock_movement', v_movement.id,
    jsonb_build_object(
      'movement_type', p_movement_type, 'direction', p_direction, 'quantity', p_quantity,
      'backorder_quantity', COALESCE(v_backorder_qty, 0),
      'unit_cost', p_unit_cost, 'item_id', p_item_id, 'variant_id', p_variant_id,
      'warehouse_id', p_warehouse_id, 'reference_type', p_reference_type, 'reference_id', p_reference_id
    )
  );

  RETURN v_movement;
END;
$$ LANGUAGE plpgsql;
