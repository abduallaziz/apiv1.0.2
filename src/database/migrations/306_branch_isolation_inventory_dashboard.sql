-- 306_branch_isolation_inventory_dashboard.sql  (Branch isolation Task 5b)
-- Branch-scoped copy of fn_inventory_dashboard_summary taking the branch's warehouse ids. NEW name (not an overload of the
-- original) so PostgREST RPC resolution is unaffected. The original stays as-is for non-isolated tenants.
-- ROLLBACK: DROP FUNCTION IF EXISTS fn_inventory_dashboard_summary_scoped(uuid, uuid[]);

CREATE OR REPLACE FUNCTION fn_inventory_dashboard_summary_scoped(p_tenant_id UUID, p_warehouse_ids UUID[])
RETURNS JSON AS $$
DECLARE
  v_inventory_value     NUMERIC;
  v_total_warehouses     BIGINT;
  v_products_in_stock    BIGINT;
  v_low_stock_items      BIGINT;
  v_out_of_stock_items   BIGINT;
  v_reserved_stock       NUMERIC;
  v_pending_pos          BIGINT;
  v_pending_receipts     BIGINT;
  v_movements_today      BIGINT;
  v_adjustments_today    BIGINT;
BEGIN
  SELECT COALESCE(SUM(cl.quantity_remaining * cl.unit_cost), 0)
    INTO v_inventory_value
    FROM cost_layers cl
   WHERE cl.tenant_id = p_tenant_id AND cl.warehouse_id = ANY(p_warehouse_ids)
     AND cl.quantity_remaining > 0;

  SELECT COUNT(*) INTO v_total_warehouses
    FROM warehouses w
   WHERE w.tenant_id = p_tenant_id AND w.id = ANY(p_warehouse_ids) AND w.deleted_at IS NULL AND w.is_active = true;

  SELECT COUNT(*) INTO v_products_in_stock
    FROM stock_levels sl
   WHERE sl.tenant_id = p_tenant_id AND sl.warehouse_id = ANY(p_warehouse_ids) AND sl.quantity_on_hand > 0;

  SELECT COUNT(*) INTO v_out_of_stock_items
    FROM inventory_reorder_points rp
   WHERE rp.tenant_id = p_tenant_id AND rp.warehouse_id = ANY(p_warehouse_ids) AND rp.is_active = true
     AND NOT EXISTS (
       SELECT 1 FROM stock_levels sl
        WHERE sl.tenant_id = rp.tenant_id
          AND sl.warehouse_id = rp.warehouse_id
          AND sl.item_id = rp.item_id
          AND COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = COALESCE(rp.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          AND sl.quantity_on_hand > 0
     );

  SELECT COUNT(*) INTO v_low_stock_items
    FROM inventory_reorder_points rp
    JOIN stock_levels sl
      ON sl.tenant_id = rp.tenant_id
     AND sl.warehouse_id = rp.warehouse_id
     AND sl.item_id = rp.item_id
     AND COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(rp.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
   WHERE rp.tenant_id = p_tenant_id AND rp.warehouse_id = ANY(p_warehouse_ids) AND rp.is_active = true
     AND sl.quantity_on_hand > 0
     AND sl.quantity_on_hand <= rp.min_quantity;

  SELECT COALESCE(SUM(sl.quantity_reserved), 0) INTO v_reserved_stock
    FROM stock_levels sl
   WHERE sl.tenant_id = p_tenant_id AND sl.warehouse_id = ANY(p_warehouse_ids);

  SELECT COUNT(*) INTO v_pending_pos
    FROM purchase_orders po
   WHERE po.tenant_id = p_tenant_id AND po.warehouse_id = ANY(p_warehouse_ids) AND po.deleted_at IS NULL
     AND po.status IN ('submitted', 'approved', 'partially_received');

  SELECT COUNT(*) INTO v_pending_receipts
    FROM goods_receipts gr
   WHERE gr.tenant_id = p_tenant_id AND gr.warehouse_id = ANY(p_warehouse_ids) AND gr.status = 'draft';

  SELECT COUNT(*) INTO v_movements_today
    FROM stock_movements sm
   WHERE sm.tenant_id = p_tenant_id AND sm.warehouse_id = ANY(p_warehouse_ids)
     AND sm.occurred_at >= date_trunc('day', NOW());

  SELECT COUNT(*) INTO v_adjustments_today
    FROM stock_adjustments sa
   WHERE sa.tenant_id = p_tenant_id AND sa.warehouse_id = ANY(p_warehouse_ids)
     AND sa.created_at >= date_trunc('day', NOW());

  RETURN json_build_object(
    'inventory_value', v_inventory_value,
    'total_warehouses', v_total_warehouses,
    'products_in_stock', v_products_in_stock,
    'low_stock_items', v_low_stock_items,
    'out_of_stock_items', v_out_of_stock_items,
    'reserved_stock', v_reserved_stock,
    'pending_purchase_orders', v_pending_pos,
    'pending_goods_receipts', v_pending_receipts,
    'movements_today', v_movements_today,
    'adjustments_today', v_adjustments_today
  );
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION fn_inventory_dashboard_summary_scoped(uuid, uuid[]) TO service_role;
