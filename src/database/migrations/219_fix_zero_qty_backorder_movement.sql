-- 219. Fix Inventory Stage 1 / I2 (Owner-approved) — fn_apply_stock_movement's
-- backorder branch inserted a stock_movements row with quantity=0 whenever
-- v_available=0 at the moment of sale (e.g. the very first sale ever made
-- against a warehouse/item combo, or stock already fully depleted/reserved).
-- v_deduct_qty := GREATEST(v_available, 0) legitimately evaluates to 0 in
-- that case, but the function unconditionally reached the final INSERT at
-- the bottom with quantity = COALESCE(v_deduct_qty, p_quantity) = 0, which
-- violates stock_movements' CHECK (quantity > 0) from migration 017 — this
-- is the original "DEFECT-001" first-sale bug traced earlier this session,
-- now confirmed still live because fn_process_sale_stock_deduction (105)
-- calls fn_apply_stock_movement with p_allow_backorder := true on every
-- completed POS sale of a has_inventory item, not just an edge case.
--
-- Fix: when the fully-backordered case leaves nothing physically deducted
-- (v_deduct_qty = 0), skip the stock_movements INSERT and event emission
-- entirely — a zero-quantity physical movement is not a real inventory
-- event and the immutable ledger's own CHECK (quantity > 0) already
-- correctly says so; recording it as a movement row is what was wrong, not
-- the constraint. The backorders row (already inserted earlier in the same
-- branch) remains the sole record of the promised-but-undelivered quantity.
-- Every other branch (damage/expiry/quality_hold/quality_release, normal
-- 'out', 'in', and the pre-existing not-allow-negative/allow-negative
-- branches) always has v_deduct_qty = p_quantity > 0 (enforced by the
-- p_quantity <= 0 guard at the top of the function) and is unaffected.
--
-- Safe to return NULL for the now-skipped case: p_allow_backorder=true is
-- passed from exactly one call site in the whole codebase
-- (fn_process_sale_stock_deduction, migration 105) and that call site uses
-- PERFORM, discarding the return value — no caller anywhere reads
-- v_movement from a backorder-triggering call, confirmed by grep across
-- every fn_apply_stock_movement call site in the migrations directory.

DROP FUNCTION IF EXISTS fn_apply_stock_movement(
  UUID, UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, UUID, UUID, BOOLEAN, BOOLEAN
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
      UPDATE stock_levels
         SET quantity_on_hand = quantity_on_hand - p_quantity,
             version = version + 1,
             updated_at = NOW()
       WHERE id = v_level.id
       RETURNING quantity_on_hand INTO v_after;
      v_deduct_qty := p_quantity;
      v_backorder_qty := 0;

    ELSIF p_allow_backorder THEN
      -- Partial (or, when v_available=0, total) fulfillment: take whatever
      -- is genuinely free, promise the rest via quantity_backorder + a
      -- backorders row tied to the order. v_deduct_qty=0 is a legitimate
      -- outcome here (nothing physically available) — handled below by
      -- skipping the stock_movements insert entirely rather than writing a
      -- zero-quantity ledger row.
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

  -- Fix (219): a fully-backordered movement with nothing physically
  -- deducted is not a real inventory event — skip the ledger insert rather
  -- than writing a CHECK-violating quantity=0 row. The backorders row
  -- above is the sole record of what was promised.
  IF v_deduct_qty > 0 THEN
    INSERT INTO stock_movements (
      tenant_id, warehouse_id, location_id, item_id, variant_id, batch_id,
      movement_type, direction, quantity, unit_cost, total_cost,
      before_quantity, after_quantity,
      reference_type, reference_id, created_by
    ) VALUES (
      p_tenant_id, p_warehouse_id, p_location_id, p_item_id, p_variant_id, p_batch_id,
      p_movement_type, p_direction, v_deduct_qty, p_unit_cost,
      v_deduct_qty * p_unit_cost,
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
  END IF;

  RETURN v_movement;
END;
$$ LANGUAGE plpgsql;
