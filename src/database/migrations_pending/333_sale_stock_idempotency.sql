-- 333_sale_stock_idempotency.sql
-- FIX (WP-D D-4): stock deduction and restock for an order were not idempotent.
--   VERIFIED locally: calling fn_process_sale_stock_deduction twice for one order wrote two sets of sale movements,
--   consumed the cost layers twice and decremented stock twice; fn_reverse_sale_stock_deduction twice restocked twice.
--   stock_movements has no unique key per reference (017: non-unique index), so nothing below the order level stopped it.
--   The sale path itself only calls deduction once per order (order-level idempotency: uq_orders_tenant_sale_attempt),
--   but retries/replays/manual re-runs and any future worker (WP-E retry job) must be safe.
-- Same signatures (CREATE OR REPLACE, no overload). Bodies = the live bodies + the guard at the top.
-- ROLLBACK: rollback/333_sale_stock_idempotency_ROLLBACK.sql (restores the previous bodies).
-- STATUS: PENDING, applied to the LOCAL disposable database only.

CREATE OR REPLACE FUNCTION public.fn_process_sale_stock_deduction(p_tenant_id uuid, p_warehouse_id uuid, p_order_id uuid, p_actor_id uuid, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_item RECORD;
  v_has_inventory BOOLEAN;
  v_unit_cost NUMERIC;
BEGIN
  -- 333: idempotent per order. A replayed/duplicated call (client retry, double submit, a second worker) used to
  -- deduct the order AGAIN (second set of movements, cost layers consumed twice, a second backorder row). The advisory
  -- lock serialises concurrent calls for the same order; the existence check makes the replay a no-op. A fully
  -- backordered order writes no movement, so existing backorder rows count as 'already processed' too.
  PERFORM pg_advisory_xact_lock(hashtextextended('sale_stock_deduct:' || p_order_id::text, 0));
  IF EXISTS (SELECT 1 FROM stock_movements
              WHERE tenant_id = p_tenant_id AND reference_type = 'order' AND reference_id = p_order_id AND movement_type = 'sale')
     OR EXISTS (SELECT 1 FROM backorders WHERE tenant_id = p_tenant_id AND order_id = p_order_id) THEN
    RETURN;
  END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_reverse_sale_stock_deduction(p_tenant_id uuid, p_order_id uuid, p_actor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_movement RECORD;
BEGIN
  -- 333: idempotent per order. Restocking twice (replayed cancel, concurrent workers) used to add the units and the
  -- cost layers back twice. One restock per order: the first call wins, later calls are no-ops.
  PERFORM pg_advisory_xact_lock(hashtextextended('sale_stock_restore:' || p_order_id::text, 0));
  IF EXISTS (SELECT 1 FROM stock_movements
              WHERE tenant_id = p_tenant_id AND reference_type = 'order' AND reference_id = p_order_id AND movement_type = 'sale_return') THEN
    RETURN;
  END IF;
  FOR v_movement IN
    SELECT * FROM stock_movements
     WHERE tenant_id = p_tenant_id
       AND reference_type = 'order'
       AND reference_id = p_order_id
       AND movement_type = 'sale'
  LOOP
    PERFORM fn_apply_stock_movement(
      p_tenant_id, v_movement.warehouse_id, v_movement.location_id,
      v_movement.item_id, v_movement.variant_id, v_movement.batch_id,
      'sale_return', 'in', v_movement.quantity, v_movement.unit_cost,
      'order', p_order_id, p_actor_id
    );

    PERFORM fn_add_cost_layer(
      p_tenant_id, v_movement.warehouse_id, v_movement.item_id, v_movement.variant_id,
      v_movement.batch_id, v_movement.quantity, v_movement.unit_cost, NULL
    );
  END LOOP;
END;
$function$;
