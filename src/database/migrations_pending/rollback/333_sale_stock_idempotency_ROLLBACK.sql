-- ROLLBACK ORDER (strict reverse of the apply order; never skip or reorder): 335, 333, 332, 330, 328, 327, 326, 325.
-- (329 and 331 are read-only / scratch-only and independent; roll 329 back only after 335.) Rolling back an earlier step while a later one is applied is NOT supported.
-- ROLLBACK of 333: restores the previous bodies of fn_process_sale_stock_deduction / fn_reverse_sale_stock_deduction.
CREATE OR REPLACE FUNCTION public.fn_process_sale_stock_deduction(p_tenant_id uuid, p_warehouse_id uuid, p_order_id uuid, p_actor_id uuid, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_reverse_sale_stock_deduction(p_tenant_id uuid, p_order_id uuid, p_actor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_movement RECORD;
BEGIN
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
