-- Fix for migration 161: fn_run_mrp used fn_purchase_suggestions'
-- forecasted_demand_during_lead_time (raw demand, ignoring the
-- below-minimum trigger and the reorder_quantity floor) as the top-level
-- "Required Quantity", then separately subtracted quantity_available/
-- quantity_incoming again — but fn_purchase_suggestions.suggested_order_quantity
-- ALREADY nets those out (GREATEST(reorder_quantity, shortfall) - available -
-- incoming). Using the raw forecast instead silently dropped any real
-- shortage triggered by "below minimum" with little/no sales history (net
-- would compute to 0 even though a real shortage exists). Fixed by using
-- suggested_order_quantity as the already-netted gross requirement, adding
-- only the two MRP-specific adjustments fn_purchase_suggestions does not
-- already account for: open production supply and safety stock.

CREATE OR REPLACE FUNCTION fn_run_mrp(
  p_tenant_id    UUID,
  p_warehouse_id UUID
) RETURNS UUID AS $$
DECLARE
  v_run_id UUID := uuid_generate_v4();
  v_sugg RECORD;
  v_active_bom_id UUID;
  v_open_prod NUMERIC;
  v_safety NUMERIC;
  v_net NUMERIC;
  v_new_id UUID;
BEGIN
  DELETE FROM planned_orders
   WHERE tenant_id = p_tenant_id AND warehouse_id = p_warehouse_id AND status = 'proposed';

  FOR v_sugg IN
    SELECT * FROM fn_purchase_suggestions(p_tenant_id) WHERE warehouse_id = p_warehouse_id
  LOOP
    v_safety := fn_calculate_safety_stock(p_tenant_id, p_warehouse_id, v_sugg.item_id, v_sugg.variant_id);
    v_open_prod := fn_get_open_production_supply(p_tenant_id, p_warehouse_id, v_sugg.item_id, v_sugg.variant_id);

    -- suggested_order_quantity is already netted against available/incoming
    -- (and floored at reorder_quantity) by fn_purchase_suggestions itself —
    -- do not subtract those again here.
    v_net := GREATEST(v_sugg.suggested_order_quantity - v_open_prod + v_safety, 0);
    IF v_net = 0 THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_active_bom_id FROM bill_of_materials
      WHERE tenant_id = p_tenant_id AND item_id = v_sugg.item_id
        AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(v_sugg.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND is_active = true AND deleted_at IS NULL
      LIMIT 1;

    IF v_active_bom_id IS NOT NULL THEN
      INSERT INTO planned_orders (
        tenant_id, warehouse_id, item_id, variant_id, order_type, bom_id,
        quantity, source, parent_planned_order_id, mrp_run_id, status
      ) VALUES (
        p_tenant_id, p_warehouse_id, v_sugg.item_id, v_sugg.variant_id, 'production', v_active_bom_id,
        v_net, 'independent_demand', NULL, v_run_id, 'proposed'
      ) RETURNING id INTO v_new_id;

      PERFORM fn_explode_bom_requirements(p_tenant_id, p_warehouse_id, v_active_bom_id, v_net, v_run_id, v_new_id, 1);
    ELSE
      INSERT INTO planned_orders (
        tenant_id, warehouse_id, item_id, variant_id, order_type, bom_id,
        quantity, source, parent_planned_order_id, mrp_run_id, status
      ) VALUES (
        p_tenant_id, p_warehouse_id, v_sugg.item_id, v_sugg.variant_id, 'purchase', NULL,
        v_net, 'independent_demand', NULL, v_run_id, 'proposed'
      );
    END IF;
  END LOOP;

  RETURN v_run_id;
END;
$$ LANGUAGE plpgsql;
