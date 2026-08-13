-- Migration 13.19 Part 1 — Quality Hold becomes a first-class inventory
-- availability state (hard block), per approved design.
--
-- Follows the EXACT precedent of quantity_damaged/quantity_expired
-- (migration 104): a sub-bucket of quantity_on_hand, excluded from
-- quantity_available, reclassified via fn_apply_stock_movement with a
-- dedicated movement type. quantity_on_hand never changes. cost_layers
-- are never touched. No fake movement — a real, audited stock_movements
-- row is created (before_quantity = after_quantity on quantity_on_hand,
-- since physically nothing moved, exactly like 'damage'/'expiry' today).

ALTER TABLE stock_levels ADD COLUMN quantity_quality_held NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (quantity_quality_held >= 0);

ALTER TABLE stock_levels DROP CONSTRAINT chk_unsellable_le_on_hand;
ALTER TABLE stock_levels ADD CONSTRAINT chk_unsellable_le_on_hand
  CHECK (quantity_reserved + quantity_damaged + quantity_expired + quantity_quality_held <= quantity_on_hand);

ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (movement_type IN (
  'receipt','sale','sale_return','adjustment_in','adjustment_out',
  'transfer_out','transfer_in','count_correction_in','count_correction_out',
  'purchase_return','damage','expiry','production_consumption','production_receipt',
  'production_scrap','subcontract_out','subcontract_in',
  'quality_hold','quality_release'
));

-- fn_apply_stock_movement: CREATE OR REPLACE with the IDENTICAL signature —
-- every existing caller keeps working unchanged. Adds 'quality_hold'/
-- 'quality_release' alongside the existing 'damage'/'expiry' reclassification
-- branch. quality_release reverses quality_hold exactly (moves quantity back
-- out of the held bucket), mirroring how a release must always be able to
-- restore availability without requiring a second stock check.
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

  IF p_movement_type IN ('damage', 'expiry', 'quality_hold') THEN
    -- Reclassification, not a physical removal: on_hand stays the same,
    -- the quantity moves into a sub-bucket excluded from quantity_available.
    v_available := v_level.quantity_on_hand - v_level.quantity_reserved
                   - v_level.quantity_damaged - v_level.quantity_expired - v_level.quantity_quality_held;
    IF NOT p_allow_negative AND v_available < p_quantity THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: available % requested % (item=% warehouse=%)',
        v_available, p_quantity, p_item_id, p_warehouse_id;
    END IF;

    IF p_movement_type = 'damage' THEN
      UPDATE stock_levels SET quantity_damaged = quantity_damaged + p_quantity, version = version + 1, updated_at = NOW()
       WHERE id = v_level.id RETURNING quantity_on_hand INTO v_after;
    ELSIF p_movement_type = 'expiry' THEN
      UPDATE stock_levels SET quantity_expired = quantity_expired + p_quantity, version = version + 1, updated_at = NOW()
       WHERE id = v_level.id RETURNING quantity_on_hand INTO v_after;
    ELSE
      UPDATE stock_levels SET quantity_quality_held = quantity_quality_held + p_quantity, version = version + 1, updated_at = NOW()
       WHERE id = v_level.id RETURNING quantity_on_hand INTO v_after;
    END IF;

  ELSIF p_movement_type = 'quality_release' THEN
    -- Reverse of quality_hold: moves quantity back out of the held bucket.
    -- Guarded by the CHECK constraint (quantity_quality_held >= 0) rather
    -- than a manual availability check — releasing never needs an
    -- availability test, only enough currently-held quantity to release.
    IF v_level.quantity_quality_held < p_quantity THEN
      RAISE EXCEPTION 'INSUFFICIENT_HELD_QUANTITY: held % requested % (item=% warehouse=%)',
        v_level.quantity_quality_held, p_quantity, p_item_id, p_warehouse_id;
    END IF;
    UPDATE stock_levels SET quantity_quality_held = quantity_quality_held - p_quantity, version = version + 1, updated_at = NOW()
     WHERE id = v_level.id RETURNING quantity_on_hand INTO v_after;

  ELSIF p_direction = 'out' THEN
    v_available := v_level.quantity_on_hand - v_level.quantity_reserved
                   - v_level.quantity_damaged - v_level.quantity_expired - v_level.quantity_quality_held;
    IF NOT p_allow_negative AND v_available < p_quantity THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: available % requested % (item=% warehouse=%)',
        v_available, p_quantity, p_item_id, p_warehouse_id;
    END IF;
    UPDATE stock_levels SET quantity_on_hand = quantity_on_hand - p_quantity, version = version + 1, updated_at = NOW()
     WHERE id = v_level.id RETURNING quantity_on_hand INTO v_after;
  ELSIF p_direction = 'in' THEN
    UPDATE stock_levels SET quantity_on_hand = quantity_on_hand + p_quantity, version = version + 1, updated_at = NOW()
     WHERE id = v_level.id RETURNING quantity_on_hand INTO v_after;
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

-- v_stock_balance: CREATE OR REPLACE, same columns, quantity_available now
-- also excludes quantity_quality_held. Every consumer (fn_purchase_suggestions,
-- fn_run_mrp, fn_explode_bom_requirements, fn_calculate_safety_stock's
-- underlying demand data, stock.repository.ts) reads this view directly and
-- inherits the fix automatically — confirmed via the migration 13.19
-- pre-implementation consumer audit.
DROP VIEW IF EXISTS v_stock_balance;
CREATE VIEW v_stock_balance AS
SELECT
  sl.*,
  (sl.quantity_on_hand - sl.quantity_reserved - sl.quantity_damaged - sl.quantity_expired - sl.quantity_quality_held) AS quantity_available,
  fn_get_incoming_quantity(sl.tenant_id, sl.warehouse_id, sl.item_id, sl.variant_id) AS quantity_incoming,
  (sl.quantity_on_hand - sl.quantity_reserved - sl.quantity_damaged - sl.quantity_expired - sl.quantity_quality_held
   + fn_get_incoming_quantity(sl.tenant_id, sl.warehouse_id, sl.item_id, sl.variant_id)
   - sl.quantity_backorder) AS quantity_atp
FROM stock_levels sl;

GRANT SELECT ON v_stock_balance TO service_role;

-- fn_create_reservation: CREATE OR REPLACE, identical signature. Its own
-- inline availability formula (migration 151) updated to match — this is
-- the actual hard-block enforcement point for sales/POS (reservations
-- already raise INSUFFICIENT_STOCK on oversell; quality-held quantity now
-- correctly reduces what's reservable, exactly like damaged/expired stock
-- already does).
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
  v_available := v_level.quantity_on_hand - v_level.quantity_reserved - v_level.quantity_damaged - v_level.quantity_expired - v_level.quantity_quality_held;

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
