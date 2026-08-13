-- Migration 13.17 Phase B — MRP Engine, part 2: BOM explosion + MRP run.
--
-- Net requirement formula (approved design, documented not silently chosen):
--   Net Requirement = GREATEST(
--     Required Quantity (gross) - Available Inventory - Incoming Purchase Orders
--     - Existing Production Supply + Safety Stock,
--     0
--   )
--
-- Reuses, does not duplicate: fn_purchase_suggestions (top-level gross
-- requirement + available + incoming, migration 113/127), fn_calculate_safety_stock
-- (migration 158/159), fn_get_incoming_quantity (migration 104),
-- v_stock_balance (migration 104/105), bill_of_materials/bom_lines
-- (migration 112). Only "existing production supply" (open production
-- orders' remaining planned-minus-produced quantity) had no prior helper —
-- added below, same shape/style as fn_get_incoming_quantity.

CREATE OR REPLACE FUNCTION fn_get_open_production_supply(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_item_id      UUID,
  p_variant_id   UUID DEFAULT NULL
) RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(po.quantity_planned - COALESCE(po.quantity_produced, 0)), 0)
  FROM production_orders po
  JOIN bill_of_materials bom ON bom.id = po.bom_id
  WHERE po.tenant_id = p_tenant_id
    AND po.warehouse_id = p_warehouse_id
    AND po.status IN ('draft', 'in_progress')
    AND bom.item_id = p_item_id
    AND (p_variant_id IS NULL AND bom.variant_id IS NULL OR bom.variant_id = p_variant_id);
$$ LANGUAGE sql STABLE;

GRANT EXECUTE ON FUNCTION fn_get_open_production_supply(UUID, UUID, UUID, UUID) TO service_role;

-- Recursive dependent-demand explosion for one BOM's components. Depth-capped
-- (not a realistic BOM-depth limit — a defensive guard against bad data,
-- since uq_bom_active_per_item should prevent true cycles). Writes proposed
-- planned_orders rows directly (VOLATILE by nature of the INSERTs) rather
-- than returning a computed set, so it can recurse into sub-assemblies while
-- preserving the parent_planned_order_id traceability chain.
CREATE OR REPLACE FUNCTION fn_explode_bom_requirements(
  p_tenant_id               UUID,
  p_warehouse_id            UUID,
  p_bom_id                  UUID,
  p_quantity                NUMERIC,
  p_mrp_run_id              UUID,
  p_parent_planned_order_id UUID,
  p_depth                   INTEGER DEFAULT 1
) RETURNS VOID AS $$
DECLARE
  v_line RECORD;
  v_gross NUMERIC;
  v_available NUMERIC;
  v_incoming NUMERIC;
  v_open_prod NUMERIC;
  v_safety NUMERIC;
  v_net NUMERIC;
  v_component_bom_id UUID;
  v_new_id UUID;
BEGIN
  IF p_depth > 10 THEN
    RAISE EXCEPTION 'MRP BOM explosion exceeded max depth (10) at bom % — check for a data error (this should not happen given uq_bom_active_per_item)', p_bom_id;
  END IF;

  FOR v_line IN SELECT * FROM bom_lines WHERE bom_id = p_bom_id LOOP
    v_gross := v_line.quantity_per_unit * p_quantity * (1 + v_line.scrap_percentage / 100);

    SELECT COALESCE(vsb.quantity_available, 0) INTO v_available
    FROM v_stock_balance vsb
    WHERE vsb.tenant_id = p_tenant_id AND vsb.warehouse_id = p_warehouse_id AND vsb.item_id = v_line.component_item_id
      AND COALESCE(vsb.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(v_line.component_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    LIMIT 1;
    v_available := COALESCE(v_available, 0);

    v_incoming := fn_get_incoming_quantity(p_tenant_id, p_warehouse_id, v_line.component_item_id, v_line.component_variant_id);
    v_open_prod := fn_get_open_production_supply(p_tenant_id, p_warehouse_id, v_line.component_item_id, v_line.component_variant_id);
    v_safety := fn_calculate_safety_stock(p_tenant_id, p_warehouse_id, v_line.component_item_id, v_line.component_variant_id);

    v_net := GREATEST(v_gross - v_available - v_incoming - v_open_prod + v_safety, 0);
    IF v_net = 0 THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_component_bom_id FROM bill_of_materials
      WHERE tenant_id = p_tenant_id AND item_id = v_line.component_item_id
        AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(v_line.component_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND is_active = true AND deleted_at IS NULL
      LIMIT 1;

    IF v_component_bom_id IS NOT NULL THEN
      INSERT INTO planned_orders (
        tenant_id, warehouse_id, item_id, variant_id, order_type, bom_id,
        quantity, source, parent_planned_order_id, mrp_run_id, status
      ) VALUES (
        p_tenant_id, p_warehouse_id, v_line.component_item_id, v_line.component_variant_id, 'production', v_component_bom_id,
        v_net, 'dependent_demand', p_parent_planned_order_id, p_mrp_run_id, 'proposed'
      ) RETURNING id INTO v_new_id;

      PERFORM fn_explode_bom_requirements(
        p_tenant_id, p_warehouse_id, v_component_bom_id, v_net, p_mrp_run_id, v_new_id, p_depth + 1
      );
    ELSE
      INSERT INTO planned_orders (
        tenant_id, warehouse_id, item_id, variant_id, order_type, bom_id,
        quantity, source, parent_planned_order_id, mrp_run_id, status
      ) VALUES (
        p_tenant_id, p_warehouse_id, v_line.component_item_id, v_line.component_variant_id, 'purchase', NULL,
        v_net, 'dependent_demand', p_parent_planned_order_id, p_mrp_run_id, 'proposed'
      );
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION fn_explode_bom_requirements(UUID, UUID, UUID, NUMERIC, UUID, UUID, INTEGER) TO service_role;

-- Full MRP run for one tenant+warehouse. Idempotent on 'proposed' rows only
-- (approved reruns): deletes prior unactioned proposals for this
-- tenant+warehouse before regenerating, per the approved rerun-behavior
-- decision — approved/converted/cancelled history is never touched.
-- Top-level (independent) demand reuses fn_purchase_suggestions' own gross
-- requirement (forecasted_demand_during_lead_time) and its already-computed
-- available/incoming columns — no demand-forecast math is duplicated here.
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

    v_net := GREATEST(
      v_sugg.forecasted_demand_during_lead_time - v_sugg.quantity_available - v_sugg.quantity_incoming - v_open_prod + v_safety,
      0
    );
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

GRANT EXECUTE ON FUNCTION fn_run_mrp(UUID, UUID) TO service_role;
