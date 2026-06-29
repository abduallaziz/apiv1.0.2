-- =============================================================================
-- 019. INVENTORY RPC FUNCTIONS
-- All functions that mutate stock_levels/cost_layers/stock_movements together
-- run as a single Postgres function invocation, which Postgres always executes
-- inside one transaction. Each function locks the relevant stock_levels row(s)
-- with SELECT ... FOR UPDATE before reading/mutating them, which serializes
-- concurrent callers and prevents lost updates / negative stock under
-- concurrency. NestJS calls these exclusively via supabase.rpc(...) for any
-- operation that must be atomic; plain CRUD (suppliers, warehouses, draft
-- purchase orders, etc.) stays as ordinary Supabase queries from repositories.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: emit a domain event into the outbox, in the same transaction as the
-- inventory mutation that caused it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _emit_domain_event(
  p_tenant_id      UUID,
  p_event_type     TEXT,
  p_aggregate_type TEXT,
  p_aggregate_id   UUID,
  p_payload        JSONB
) RETURNS VOID AS $$
BEGIN
  INSERT INTO domain_events_outbox (tenant_id, event_type, aggregate_type, aggregate_id, payload)
  VALUES (p_tenant_id, p_event_type, p_aggregate_type, p_aggregate_id, p_payload);
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Helper: lock (creating if absent) the stock_levels row for a stocking point.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _lock_or_create_stock_level(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_location_id  UUID,
  p_item_id      UUID,
  p_variant_id   UUID,
  p_batch_id     UUID
) RETURNS stock_levels AS $$
DECLARE
  v_row stock_levels;
BEGIN
  SELECT * INTO v_row FROM stock_levels
   WHERE tenant_id = p_tenant_id
     AND warehouse_id = p_warehouse_id
     AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_location_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND item_id = p_item_id
     AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_batch_id, '00000000-0000-0000-0000-000000000000'::uuid)
   FOR UPDATE;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  INSERT INTO stock_levels (tenant_id, warehouse_id, location_id, item_id, variant_id, batch_id)
  VALUES (p_tenant_id, p_warehouse_id, p_location_id, p_item_id, p_variant_id, p_batch_id)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Core primitive: apply one stock movement. Locks the stock_levels row,
-- validates sufficient available quantity for outbound movements, writes the
-- immutable ledger entry, updates the projection (with version bump), and
-- emits a domain event. Used by every higher-level RPC below.
-- -----------------------------------------------------------------------------
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
  v_level   stock_levels;
  v_movement stock_movements;
  v_available NUMERIC;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive, got %', p_quantity;
  END IF;

  v_level := _lock_or_create_stock_level(p_tenant_id, p_warehouse_id, p_location_id, p_item_id, p_variant_id, p_batch_id);

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
     WHERE id = v_level.id;
  ELSIF p_direction = 'in' THEN
    UPDATE stock_levels
       SET quantity_on_hand = quantity_on_hand + p_quantity,
           version = version + 1,
           updated_at = NOW()
     WHERE id = v_level.id;
  ELSE
    RAISE EXCEPTION 'invalid direction %', p_direction;
  END IF;

  INSERT INTO stock_movements (
    tenant_id, warehouse_id, location_id, item_id, variant_id, batch_id,
    movement_type, direction, quantity, unit_cost, total_cost,
    reference_type, reference_id, created_by
  ) VALUES (
    p_tenant_id, p_warehouse_id, p_location_id, p_item_id, p_variant_id, p_batch_id,
    p_movement_type, p_direction, p_quantity, p_unit_cost, p_quantity * p_unit_cost,
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

-- -----------------------------------------------------------------------------
-- Add a cost layer on receipt. For 'fifo' items this inserts a new layer.
-- For 'average' items it maintains a single open layer, recomputing the
-- weighted-average unit cost.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_add_cost_layer(
  p_tenant_id     UUID,
  p_warehouse_id  UUID,
  p_item_id       UUID,
  p_variant_id    UUID,
  p_batch_id      UUID,
  p_quantity      NUMERIC,
  p_unit_cost     NUMERIC,
  p_source_movement_id UUID
) RETURNS VOID AS $$
DECLARE
  v_costing_method TEXT;
  v_layer cost_layers;
BEGIN
  SELECT costing_method INTO v_costing_method FROM items WHERE id = p_item_id;

  IF v_costing_method = 'average' THEN
    SELECT * INTO v_layer FROM cost_layers
     WHERE tenant_id = p_tenant_id AND warehouse_id = p_warehouse_id AND item_id = p_item_id
       AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND quantity_remaining > 0
     ORDER BY received_at
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      UPDATE cost_layers
         SET unit_cost = ROUND(
               ((unit_cost * quantity_remaining) + (p_unit_cost * p_quantity))
               / (quantity_remaining + p_quantity), 4
             ),
             quantity_remaining = quantity_remaining + p_quantity,
             quantity_received = quantity_received + p_quantity
       WHERE id = v_layer.id;
      RETURN;
    END IF;
    -- no open layer yet — fall through to create the first one
  END IF;

  INSERT INTO cost_layers (
    tenant_id, warehouse_id, item_id, variant_id, batch_id,
    source_movement_id, unit_cost, quantity_received, quantity_remaining
  ) VALUES (
    p_tenant_id, p_warehouse_id, p_item_id, p_variant_id, p_batch_id,
    p_source_movement_id, p_unit_cost, p_quantity, p_quantity
  );
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Consume cost layers FIFO (or the single average layer) for an outbound
-- movement. Returns the weighted unit cost actually consumed, which the
-- caller uses as unit_cost on the stock_movement row.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_consume_cost_layers(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_item_id      UUID,
  p_variant_id   UUID,
  p_quantity     NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
  v_layer        RECORD;
  v_remaining_to_consume NUMERIC := p_quantity;
  v_total_cost   NUMERIC := 0;
  v_take         NUMERIC;
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

  IF v_remaining_to_consume > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_COST_LAYERS: could not source cost for % of item % at warehouse %',
      v_remaining_to_consume, p_item_id, p_warehouse_id;
  END IF;

  RETURN ROUND(v_total_cost / p_quantity, 4);
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Post a goods receipt: for every line, records an inbound movement, adds a
-- cost layer (creating an item_batches row first if batch/serial data was
-- supplied), updates the source PO line + PO status, and marks the receipt
-- posted. Idempotent against re-posting (raises if already posted).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_goods_receipt(
  p_goods_receipt_id UUID,
  p_actor_id         UUID
) RETURNS goods_receipts AS $$
DECLARE
  v_receipt goods_receipts;
  v_line    RECORD;
  v_batch_id UUID;
  v_movement stock_movements;
  v_po_total_ordered NUMERIC;
  v_po_total_received NUMERIC;
BEGIN
  SELECT * INTO v_receipt FROM goods_receipts WHERE id = p_goods_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'goods receipt % not found', p_goods_receipt_id;
  END IF;
  IF v_receipt.status <> 'draft' THEN
    RAISE EXCEPTION 'goods receipt % is not in draft status (status=%)', p_goods_receipt_id, v_receipt.status;
  END IF;

  FOR v_line IN SELECT * FROM goods_receipt_items WHERE goods_receipt_id = p_goods_receipt_id LOOP
    v_batch_id := NULL;

    IF v_line.batch_number IS NOT NULL OR v_line.serial_number IS NOT NULL THEN
      INSERT INTO item_batches (tenant_id, item_id, variant_id, batch_number, serial_number, expiration_date)
      VALUES (v_receipt.tenant_id, v_line.item_id, v_line.variant_id, v_line.batch_number, v_line.serial_number, v_line.expiration_date)
      RETURNING id INTO v_batch_id;
    END IF;

    v_movement := fn_apply_stock_movement(
      v_receipt.tenant_id, v_receipt.warehouse_id, NULL, v_line.item_id, v_line.variant_id, v_batch_id,
      'receipt', 'in', v_line.quantity_received, v_line.unit_cost,
      'goods_receipt', p_goods_receipt_id, p_actor_id
    );

    PERFORM fn_add_cost_layer(
      v_receipt.tenant_id, v_receipt.warehouse_id, v_line.item_id, v_line.variant_id, v_batch_id,
      v_line.quantity_received, v_line.unit_cost, v_movement.id
    );

    IF v_line.purchase_order_item_id IS NOT NULL THEN
      UPDATE purchase_order_items
         SET quantity_received = quantity_received + v_line.quantity_received
       WHERE id = v_line.purchase_order_item_id;
    END IF;
  END LOOP;

  UPDATE goods_receipts
     SET status = 'posted', received_by = p_actor_id, received_at = NOW(), updated_at = NOW()
   WHERE id = p_goods_receipt_id
   RETURNING * INTO v_receipt;

  IF v_receipt.purchase_order_id IS NOT NULL THEN
    SELECT SUM(quantity_ordered), SUM(quantity_received)
      INTO v_po_total_ordered, v_po_total_received
      FROM purchase_order_items WHERE purchase_order_id = v_receipt.purchase_order_id;

    UPDATE purchase_orders
       SET status = CASE
             WHEN v_po_total_received >= v_po_total_ordered THEN 'received'
             WHEN v_po_total_received > 0 THEN 'partially_received'
             ELSE status
           END,
           updated_at = NOW()
     WHERE id = v_receipt.purchase_order_id;
  END IF;

  PERFORM _emit_domain_event(
    v_receipt.tenant_id, 'inventory.goods_receipt.posted', 'goods_receipt', v_receipt.id,
    jsonb_build_object('purchase_order_id', v_receipt.purchase_order_id, 'warehouse_id', v_receipt.warehouse_id)
  );

  RETURN v_receipt;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Reservations
-- -----------------------------------------------------------------------------
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
  v_available := v_level.quantity_on_hand - v_level.quantity_reserved;

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

CREATE OR REPLACE FUNCTION fn_release_reservation(
  p_reservation_id UUID,
  p_resulting_status TEXT DEFAULT 'released'
) RETURNS stock_reservations AS $$
DECLARE
  v_reservation stock_reservations;
  v_level stock_levels;
BEGIN
  IF p_resulting_status NOT IN ('released', 'consumed', 'expired') THEN
    RAISE EXCEPTION 'invalid resulting status %', p_resulting_status;
  END IF;

  SELECT * INTO v_reservation FROM stock_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation % not found', p_reservation_id;
  END IF;
  IF v_reservation.status <> 'active' THEN
    RAISE EXCEPTION 'reservation % is not active (status=%)', p_reservation_id, v_reservation.status;
  END IF;

  v_level := _lock_or_create_stock_level(
    v_reservation.tenant_id, v_reservation.warehouse_id, NULL,
    v_reservation.item_id, v_reservation.variant_id, v_reservation.batch_id
  );

  UPDATE stock_levels
     SET quantity_reserved = quantity_reserved - v_reservation.quantity,
         version = version + 1,
         updated_at = NOW()
   WHERE id = v_level.id;

  UPDATE stock_reservations
     SET status = p_resulting_status, released_at = NOW()
   WHERE id = p_reservation_id
   RETURNING * INTO v_reservation;

  PERFORM _emit_domain_event(
    v_reservation.tenant_id, 'inventory.reservation.' || p_resulting_status, 'stock_reservation', v_reservation.id,
    jsonb_build_object('item_id', v_reservation.item_id, 'warehouse_id', v_reservation.warehouse_id, 'quantity', v_reservation.quantity)
  );

  RETURN v_reservation;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Two-phase transfer: dispatch removes stock + cost from source and records
-- the consumed weighted unit cost per line; receive adds stock + a fresh cost
-- layer at the destination using that carried cost. Stock is "in transit"
-- (off source's books, not yet on destination's) between the two phases.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_transfer_dispatch(
  p_transfer_id UUID,
  p_actor_id    UUID
) RETURNS stock_transfers AS $$
DECLARE
  v_transfer stock_transfers;
  v_line     RECORD;
  v_unit_cost NUMERIC;
BEGIN
  SELECT * INTO v_transfer FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer % not found', p_transfer_id;
  END IF;
  IF v_transfer.status <> 'draft' THEN
    RAISE EXCEPTION 'transfer % is not in draft status (status=%)', p_transfer_id, v_transfer.status;
  END IF;

  FOR v_line IN SELECT * FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id LOOP
    v_unit_cost := fn_consume_cost_layers(
      v_transfer.tenant_id, v_transfer.from_warehouse_id, v_line.item_id, v_line.variant_id, v_line.quantity
    );

    PERFORM fn_apply_stock_movement(
      v_transfer.tenant_id, v_transfer.from_warehouse_id, NULL, v_line.item_id, v_line.variant_id, v_line.batch_id,
      'transfer_out', 'out', v_line.quantity, v_unit_cost,
      'stock_transfer', p_transfer_id, p_actor_id
    );

    UPDATE stock_transfer_items SET dispatched_unit_cost = v_unit_cost WHERE id = v_line.id;
  END LOOP;

  UPDATE stock_transfers
     SET status = 'in_transit', dispatched_by = p_actor_id, dispatched_at = NOW()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  PERFORM _emit_domain_event(
    v_transfer.tenant_id, 'inventory.transfer.dispatched', 'stock_transfer', v_transfer.id,
    jsonb_build_object('from_warehouse_id', v_transfer.from_warehouse_id, 'to_warehouse_id', v_transfer.to_warehouse_id)
  );

  RETURN v_transfer;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_transfer_receive(
  p_transfer_id UUID,
  p_actor_id    UUID
) RETURNS stock_transfers AS $$
DECLARE
  v_transfer stock_transfers;
  v_line     RECORD;
  v_movement stock_movements;
BEGIN
  SELECT * INTO v_transfer FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer % not found', p_transfer_id;
  END IF;
  IF v_transfer.status <> 'in_transit' THEN
    RAISE EXCEPTION 'transfer % is not in_transit (status=%)', p_transfer_id, v_transfer.status;
  END IF;

  FOR v_line IN SELECT * FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id LOOP
    v_movement := fn_apply_stock_movement(
      v_transfer.tenant_id, v_transfer.to_warehouse_id, NULL, v_line.item_id, v_line.variant_id, v_line.batch_id,
      'transfer_in', 'in', v_line.quantity, v_line.dispatched_unit_cost,
      'stock_transfer', p_transfer_id, p_actor_id
    );

    PERFORM fn_add_cost_layer(
      v_transfer.tenant_id, v_transfer.to_warehouse_id, v_line.item_id, v_line.variant_id, v_line.batch_id,
      v_line.quantity, v_line.dispatched_unit_cost, v_movement.id
    );

    UPDATE stock_transfer_items SET quantity_received = COALESCE(quantity_received, 0) + v_line.quantity WHERE id = v_line.id;
  END LOOP;

  UPDATE stock_transfers
     SET status = 'completed', received_by = p_actor_id, received_at = NOW()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  PERFORM _emit_domain_event(
    v_transfer.tenant_id, 'inventory.transfer.completed', 'stock_transfer', v_transfer.id,
    jsonb_build_object('from_warehouse_id', v_transfer.from_warehouse_id, 'to_warehouse_id', v_transfer.to_warehouse_id)
  );

  RETURN v_transfer;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Stock adjustment posting. Must already be 'approved' (or never required
-- approval) before posting — the approval workflow itself is orchestrated in
-- NestJS (business policy), this function only performs the atomic posting.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_stock_adjustment(
  p_adjustment_id UUID,
  p_actor_id      UUID
) RETURNS stock_adjustments AS $$
DECLARE
  v_adj stock_adjustments;
  v_unit_cost NUMERIC;
  v_movement stock_movements;
BEGIN
  SELECT * INTO v_adj FROM stock_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'adjustment % not found', p_adjustment_id;
  END IF;
  IF v_adj.status NOT IN ('pending_approval', 'approved') THEN
    RAISE EXCEPTION 'adjustment % cannot be posted from status %', p_adjustment_id, v_adj.status;
  END IF;
  IF v_adj.requires_approval AND v_adj.status <> 'approved' THEN
    RAISE EXCEPTION 'adjustment % requires approval before posting', p_adjustment_id;
  END IF;

  IF v_adj.quantity_delta > 0 THEN
    v_unit_cost := COALESCE(v_adj.unit_cost, (SELECT cost_price FROM items WHERE id = v_adj.item_id), 0);

    v_movement := fn_apply_stock_movement(
      v_adj.tenant_id, v_adj.warehouse_id, NULL, v_adj.item_id, v_adj.variant_id, v_adj.batch_id,
      'adjustment_in', 'in', v_adj.quantity_delta, v_unit_cost,
      'stock_adjustment', p_adjustment_id, p_actor_id
    );

    PERFORM fn_add_cost_layer(
      v_adj.tenant_id, v_adj.warehouse_id, v_adj.item_id, v_adj.variant_id, v_adj.batch_id,
      v_adj.quantity_delta, v_unit_cost, v_movement.id
    );
  ELSE
    v_unit_cost := fn_consume_cost_layers(
      v_adj.tenant_id, v_adj.warehouse_id, v_adj.item_id, v_adj.variant_id, ABS(v_adj.quantity_delta)
    );

    PERFORM fn_apply_stock_movement(
      v_adj.tenant_id, v_adj.warehouse_id, NULL, v_adj.item_id, v_adj.variant_id, v_adj.batch_id,
      'adjustment_out', 'out', ABS(v_adj.quantity_delta), v_unit_cost,
      'stock_adjustment', p_adjustment_id, p_actor_id
    );
  END IF;

  UPDATE stock_adjustments
     SET status = 'posted', posted_at = NOW()
   WHERE id = p_adjustment_id
   RETURNING * INTO v_adj;

  PERFORM _emit_domain_event(
    v_adj.tenant_id, 'inventory.adjustment.posted', 'stock_adjustment', v_adj.id,
    jsonb_build_object('item_id', v_adj.item_id, 'warehouse_id', v_adj.warehouse_id, 'quantity_delta', v_adj.quantity_delta)
  );

  RETURN v_adj;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Finalize a stock count: for every counted line with a variance, post the
-- correcting movement (count_correction_in / count_correction_out), then mark
-- the count completed. Lines without a counted_quantity are skipped (not
-- counted) and lines with zero variance need no movement.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_finalize_stock_count(
  p_stock_count_id UUID,
  p_actor_id       UUID
) RETURNS stock_counts AS $$
DECLARE
  v_count stock_counts;
  v_line  RECORD;
  v_unit_cost NUMERIC;
  v_movement stock_movements;
BEGIN
  SELECT * INTO v_count FROM stock_counts WHERE id = p_stock_count_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock count % not found', p_stock_count_id;
  END IF;
  IF v_count.status <> 'in_progress' THEN
    RAISE EXCEPTION 'stock count % is not in_progress (status=%)', p_stock_count_id, v_count.status;
  END IF;

  FOR v_line IN
    SELECT * FROM stock_count_items
     WHERE stock_count_id = p_stock_count_id AND counted_quantity IS NOT NULL
  LOOP
    UPDATE stock_count_items
       SET variance = v_line.counted_quantity - v_line.expected_quantity
     WHERE id = v_line.id;

    IF v_line.counted_quantity = v_line.expected_quantity THEN
      CONTINUE;
    END IF;

    IF v_line.counted_quantity > v_line.expected_quantity THEN
      v_unit_cost := COALESCE((SELECT cost_price FROM items WHERE id = v_line.item_id), 0);

      v_movement := fn_apply_stock_movement(
        v_count.tenant_id, v_count.warehouse_id, v_line.location_id, v_line.item_id, v_line.variant_id, v_line.batch_id,
        'count_correction_in', 'in', v_line.counted_quantity - v_line.expected_quantity, v_unit_cost,
        'stock_count', p_stock_count_id, p_actor_id
      );

      PERFORM fn_add_cost_layer(
        v_count.tenant_id, v_count.warehouse_id, v_line.item_id, v_line.variant_id, v_line.batch_id,
        v_line.counted_quantity - v_line.expected_quantity, v_unit_cost, v_movement.id
      );
    ELSE
      v_unit_cost := fn_consume_cost_layers(
        v_count.tenant_id, v_count.warehouse_id, v_line.item_id, v_line.variant_id,
        v_line.expected_quantity - v_line.counted_quantity
      );

      PERFORM fn_apply_stock_movement(
        v_count.tenant_id, v_count.warehouse_id, v_line.location_id, v_line.item_id, v_line.variant_id, v_line.batch_id,
        'count_correction_out', 'out', v_line.expected_quantity - v_line.counted_quantity, v_unit_cost,
        'stock_count', p_stock_count_id, p_actor_id, true
      );
    END IF;
  END LOOP;

  UPDATE stock_counts
     SET status = 'completed', completed_by = p_actor_id, completed_at = NOW()
   WHERE id = p_stock_count_id
   RETURNING * INTO v_count;

  PERFORM _emit_domain_event(
    v_count.tenant_id, 'inventory.stock_count.completed', 'stock_count', v_count.id,
    jsonb_build_object('warehouse_id', v_count.warehouse_id)
  );

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
