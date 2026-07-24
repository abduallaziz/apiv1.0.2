-- Inventory redesign — Part A item #11 continuation: Backorder tracking.
--
-- quantity_backorder is a PROMISE, not physical stock — deliberately
-- excluded from chk_unsellable_le_on_hand (it can legitimately exceed
-- on_hand; that's the whole point of a backorder).
ALTER TABLE stock_levels ADD COLUMN quantity_backorder NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (quantity_backorder >= 0);

-- One row per unfulfilled shortfall, linked to the order that caused it —
-- "backordered quantities are automatically associated with the original
-- order" per spec. Multiple rows can exist per stock_levels point over
-- time (one per order that oversold against it); fulfilled independently,
-- oldest first, as real stock arrives.
CREATE TABLE backorders (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id       UUID          NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id            UUID          NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  variant_id         UUID          REFERENCES item_variants(id) ON DELETE RESTRICT,
  order_id           UUID          REFERENCES orders(id) ON DELETE SET NULL,
  quantity           NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  quantity_fulfilled NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (quantity_fulfilled >= 0),
  status             TEXT          NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partially_fulfilled', 'fulfilled', 'cancelled')),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  fulfilled_at       TIMESTAMPTZ,
  CONSTRAINT chk_bo_fulfilled_le_quantity CHECK (quantity_fulfilled <= quantity)
);
CREATE INDEX idx_backorders_open ON backorders(tenant_id, warehouse_id, item_id, variant_id, created_at)
  WHERE status IN ('open', 'partially_fulfilled');
CREATE INDEX idx_backorders_order ON backorders(tenant_id, order_id);

GRANT ALL PRIVILEGES ON public.backorders TO service_role;

-- CREATE OR REPLACE, one new trailing parameter with a default — every
-- existing call site (transfers, adjustments, counts, generic sales
-- without backorder support) is unaffected, since p_allow_backorder
-- defaults to false and the function behaves EXACTLY as migration 104
-- left it in that case (raises INSUFFICIENT_STOCK, or the damage/expiry
-- reclassification branch — both untouched below).
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

  IF p_movement_type IN ('damage', 'expiry') THEN
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

-- CREATE OR REPLACE with one new trailing parameter (default false) —
-- every existing call site keeps raising INSUFFICIENT_COST_LAYERS exactly
-- as before. Sales pass p_allow_partial := true: instead of raising when
-- layers run short, consume whatever real cost layers exist and return
-- the average cost of THAT (smaller) amount — the backordered remainder
-- has no cost layer yet (nothing's been purchased for it), consistent
-- with FIFO/weighted-avg: its cost gets assigned for real once received.
CREATE OR REPLACE FUNCTION fn_consume_cost_layers(
  p_tenant_id     UUID,
  p_warehouse_id  UUID,
  p_item_id       UUID,
  p_variant_id    UUID,
  p_quantity      NUMERIC,
  p_allow_partial BOOLEAN DEFAULT false
) RETURNS NUMERIC AS $$
DECLARE
  v_layer        RECORD;
  v_remaining_to_consume NUMERIC := p_quantity;
  v_total_cost   NUMERIC := 0;
  v_take         NUMERIC;
  v_consumed     NUMERIC;
BEGIN
  FOR v_layer IN
    SELECT * FROM cost_layers
     WHERE tenant_id = p_tenant_id AND warehouse_id = p_warehouse_id AND item_id = p_item_id
       AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND quantity_remaining > 0
     ORDER BY received_at
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining_to_consume <= 0;

    v_take := LEAST(v_layer.quantity_remaining, v_remaining_to_consume);

    UPDATE cost_layers SET quantity_remaining = quantity_remaining - v_take WHERE id = v_layer.id;

    v_total_cost := v_total_cost + (v_take * v_layer.unit_cost);
    v_remaining_to_consume := v_remaining_to_consume - v_take;
  END LOOP;

  v_consumed := p_quantity - v_remaining_to_consume;

  IF v_remaining_to_consume > 0 THEN
    IF NOT p_allow_partial THEN
      RAISE EXCEPTION 'INSUFFICIENT_COST_LAYERS: could not source cost for % of item % at warehouse %',
        v_remaining_to_consume, p_item_id, p_warehouse_id;
    END IF;
    IF v_consumed = 0 THEN
      RETURN 0;
    END IF;
    RETURN ROUND(v_total_cost / v_consumed, 4);
  END IF;

  RETURN ROUND(v_total_cost / p_quantity, 4);
END;
$$ LANGUAGE plpgsql;

-- Sales specifically opt into backorder-on-oversell (p_allow_backorder :=
-- true) — this is the ONLY call site that gets this behavior; transfers/
-- adjustments/counts elsewhere in the codebase still call
-- fn_apply_stock_movement without the new param and keep raising
-- INSUFFICIENT_STOCK exactly as before.
CREATE OR REPLACE FUNCTION fn_process_sale_stock_deduction(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_order_id     UUID,
  p_actor_id     UUID,
  p_items        JSONB
) RETURNS VOID AS $$
DECLARE
  v_item RECORD;
  v_has_inventory BOOLEAN;
  v_unit_cost NUMERIC;
BEGIN
  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS x(item_id UUID, variant_id UUID, quantity NUMERIC)
  LOOP
    SELECT has_inventory INTO v_has_inventory FROM items WHERE id = v_item.item_id;
    IF NOT COALESCE(v_has_inventory, false) THEN
      CONTINUE;
    END IF;

    v_unit_cost := fn_consume_cost_layers(
      p_tenant_id, p_warehouse_id, v_item.item_id, v_item.variant_id, v_item.quantity,
      true -- p_allow_partial: shortfall becomes a backorder below, not a hard failure
    );

    PERFORM fn_apply_stock_movement(
      p_tenant_id, p_warehouse_id, NULL, v_item.item_id, v_item.variant_id, NULL,
      'sale', 'out', v_item.quantity, v_unit_cost,
      'order', p_order_id, p_actor_id,
      false, -- p_allow_negative
      true   -- p_allow_backorder
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ATP now also subtracts existing backorder commitments — stock already
-- promised to a prior order isn't free for a new one.
DROP VIEW IF EXISTS v_stock_balance;
CREATE VIEW v_stock_balance AS
SELECT
  sl.*,
  (sl.quantity_on_hand - sl.quantity_reserved - sl.quantity_damaged - sl.quantity_expired) AS quantity_available,
  fn_get_incoming_quantity(sl.tenant_id, sl.warehouse_id, sl.item_id, sl.variant_id) AS quantity_incoming,
  (sl.quantity_on_hand - sl.quantity_reserved - sl.quantity_damaged - sl.quantity_expired
   + fn_get_incoming_quantity(sl.tenant_id, sl.warehouse_id, sl.item_id, sl.variant_id)
   - sl.quantity_backorder) AS quantity_atp
FROM stock_levels sl;

GRANT SELECT ON v_stock_balance TO service_role;
