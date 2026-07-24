-- Inventory redesign — Part A item #4: Balance Engine states.
--
-- Adds the two genuinely-missing states from the spec: damaged and expired
-- stock, as sub-buckets of quantity_on_hand (the physical unit is still
-- sitting in the warehouse until formally written off — it does NOT
-- disappear from on_hand, it just becomes excluded from what's sellable).
-- "Incoming" is deliberately NOT a new stored column — purchase_order_items
-- (quantity_ordered - quantity_received) is already the single source of
-- truth for that; a second stored copy would just be a sync-bug risk.
-- fn_get_incoming_quantity() below reads it live instead.

ALTER TABLE stock_levels ADD COLUMN quantity_damaged NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (quantity_damaged >= 0);
ALTER TABLE stock_levels ADD COLUMN quantity_expired  NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (quantity_expired >= 0);

ALTER TABLE stock_levels DROP CONSTRAINT chk_reserved_le_on_hand;
ALTER TABLE stock_levels ADD CONSTRAINT chk_unsellable_le_on_hand
  CHECK (quantity_reserved + quantity_damaged + quantity_expired <= quantity_on_hand);

-- CREATE OR REPLACE with the IDENTICAL signature as migration 096 — every
-- existing caller keeps working unchanged. The only new behavior: when
-- p_movement_type is 'damage' or 'expiry', the quantity is reclassified
-- (moved into quantity_damaged/quantity_expired) instead of leaving
-- on_hand entirely, since the stock is still physically present.
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

  IF p_movement_type IN ('damage', 'expiry') THEN
    -- Reclassification, not a physical removal: on_hand stays the same,
    -- the quantity just moves into the damaged/expired sub-bucket, which
    -- excludes it from the available-to-sell calculation below.
    v_available := v_level.quantity_on_hand - v_level.quantity_reserved
                   - v_level.quantity_damaged - v_level.quantity_expired;
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
    ELSE
      UPDATE stock_levels
         SET quantity_expired = quantity_expired + p_quantity,
             version = version + 1,
             updated_at = NOW()
       WHERE id = v_level.id
       RETURNING quantity_on_hand INTO v_after;
    END IF;
  ELSIF p_direction = 'out' THEN
    v_available := v_level.quantity_on_hand - v_level.quantity_reserved
                   - v_level.quantity_damaged - v_level.quantity_expired;
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

-- Read-only: quantity on open purchase orders not yet received, for a
-- given item/variant at a warehouse. Not stored — always computed live
-- from purchase_order_items so it can never drift out of sync.
CREATE OR REPLACE FUNCTION fn_get_incoming_quantity(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_item_id      UUID,
  p_variant_id   UUID DEFAULT NULL
) RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(poi.quantity_ordered - poi.quantity_received), 0)
  FROM purchase_order_items poi
  JOIN purchase_orders po ON po.id = poi.purchase_order_id
  WHERE po.tenant_id = p_tenant_id
    AND po.warehouse_id = p_warehouse_id
    AND po.deleted_at IS NULL
    AND po.status IN ('submitted', 'approved', 'partially_received')
    AND poi.item_id = p_item_id
    AND (p_variant_id IS NULL AND poi.variant_id IS NULL OR poi.variant_id = p_variant_id);
$$ LANGUAGE sql STABLE;

-- Convenience read view — the full balance picture (on_hand, reserved,
-- damaged, expired, available_to_sell, incoming) in one row per stock
-- level, instead of every caller re-deriving the arithmetic separately.
CREATE OR REPLACE VIEW v_stock_balance AS
SELECT
  sl.*,
  (sl.quantity_on_hand - sl.quantity_reserved - sl.quantity_damaged - sl.quantity_expired) AS quantity_available,
  fn_get_incoming_quantity(sl.tenant_id, sl.warehouse_id, sl.item_id, sl.variant_id) AS quantity_incoming
FROM stock_levels sl;

-- Learning from migrations 099/100: grants included from the start.
GRANT SELECT ON v_stock_balance TO service_role;
GRANT EXECUTE ON FUNCTION fn_get_incoming_quantity(UUID, UUID, UUID, UUID) TO service_role;
